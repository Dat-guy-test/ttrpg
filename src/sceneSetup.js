// ============================================================
// SCENE SETUP
//
// Exports:
//   initScene()    — creates and wires everything into AppState
//   addToBloom(obj)— helper: assign a mesh to the bloom layer
//
// Call initScene() once at boot (before new Tree() or treeGen()).
// Everything it creates is stored on AppState so other modules
// can reach it without importing this file.
// ============================================================

import './style.css'
import './characterSheet.css';
import './equipment.css';
import './arcana.css';
import './manual.css';
import * as THREE from 'three';
import { WebGLRenderer } from 'three';
import { EffectComposer, EffectPass, RenderPass, SelectiveBloomEffect } from 'postprocessing';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import AppState from './appState.js';
import { BLOOM_LAYER, BASE_CAMERA_FOV } from './constants.js';
import { computeStarHSL, hslToRgb } from './colorScience.js';


// ============================================================
// addToBloom
// Assigns a mesh to the BLOOM_LAYER and registers it with the
// SelectiveBloomEffect selection set so it emits glow.
// Must be called after initScene() has set AppState.bloomEffect.
// ============================================================
export function addToBloom(obj) {
    obj.layers.set(BLOOM_LAYER);
    AppState.bloomEffect.selection.add(obj);
}


// ============================================================
// STARFIELD  (purely cosmetic — background stars outside the tree sphere)
//
// A single THREE.Points cloud. Because the main camera only ever
// rotates (never translates — see AppState.camera.position, fixed at
// the origin), this behaves exactly like the skybox: placed at any
// radius outside the tree sphere (30) it reads as "infinitely far
// away", so there's no need to push it out anywhere near the
// skybox's radius of 100000.
//
// Each star's colour comes from the SAME blackbody pipeline
// StarModel.js uses for perk nodes (computeStarHSL → hslToRgb), fed
// a temperature randomised between 1000 K (deep red) and 10000 K
// (blue-white) per star, instead of a flat white/tinted colour. This
// keeps the whole scene's "every glowing point is a blackbody star"
// visual language consistent between the perk tree and the backdrop.
//
// PERFORMANCE / STABILITY NOTE (read before touching `count`):
// computeStarHSL() is NOT cheap — it integrates an 81-sample Planck
// spectrum (several Math.pow/Math.exp calls per sample) to get one
// colour. Calling it once per star (as an earlier version of this
// file did) means `count * 81` of those expensive samples running
// synchronously inside initScene(), before the render loop even
// starts. At count = 12000 that's ~972,000 spectral samples on the
// main thread in one uninterrupted block — long enough on many
// GPU/driver combinations to stall frame submission and cause the
// browser to reclaim/reset the WebGL context. Once that happens,
// Three.js's internal render-list/object bookkeeping can end up
// inconsistent, which is what surfaces later as the renderer
// crashing deep in projectObject() (reading a property off an
// object it expected to still be valid) — plus the whole page
// visibly hangs while the computation runs.
//
// The fix is buildStarColorLUT() below: it runs computeStarHSL()
// only STARFIELD_COLOR_LUT_SIZE times (a small fixed number) to build
// a lookup table spanning the min/max temperature range once, and
// every star just picks a random entry from that table. Visually
// this is indistinguishable from computing every star individually
// (temperature was already uniform-random across the same range),
// but the cost drops from `count * 81` to `LUT_SIZE * 81` — roughly
// a 250x reduction at the default count/LUT size.
// ============================================================

const STARFIELD_MIN_TEMPERATURE = 1000;  // Kelvin — deep red
const STARFIELD_MAX_TEMPERATURE = 10000; // Kelvin — blue-white

// How many distinct blackbody colours to precompute for the starfield.
// Large enough that stars don't visibly repeat in clumps, small enough
// that building it is effectively instantaneous (see the perf note above).
const STARFIELD_COLOR_LUT_SIZE = 48;

/**
 * Builds a soft, glowing dot texture on a canvas, used as the sprite
 * for every point in the starfield. This bakes the "glow" directly
 * into the texture (a bright core fading through a wide, soft halo)
 * rather than relying on the postprocessing library's selective
 * bloom — SelectiveBloomEffect's internal masking/luminance passes
 * are written and tested against ordinary triangle-based Mesh
 * geometry, and don't reliably preserve THREE.Points' GL_POINTS
 * rendering (gl_PointSize logic lives in PointsMaterial specifically),
 * which was making every star vanish entirely once bloomed. Paired
 * with additive blending (see createStarfield() below), this reads as
 * "glowing" on its own, with no dependency on that pipeline.
 */
function createStarSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4,  'rgba(255,255,255,0.35)');
    grad.addColorStop(0.7,  'rgba(255,255,255,0.08)');
    grad.addColorStop(1,    'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

/**
 * Precomputes STARFIELD_COLOR_LUT_SIZE blackbody colours evenly
 * spaced across [STARFIELD_MIN_TEMPERATURE, STARFIELD_MAX_TEMPERATURE],
 * ONE TIME — see the perf note in the STARFIELD header comment above
 * for why this replaced calling computeStarHSL() per star.
 * @returns {[number,number,number][]} LUT_SIZE entries of [r, g, b] in [0,1]
 */
function buildStarColorLUT() {
    const lut = [];
    for (let i = 0; i < STARFIELD_COLOR_LUT_SIZE; i++) {
        const t = STARFIELD_MIN_TEMPERATURE
            + (i / Math.max(1, STARFIELD_COLOR_LUT_SIZE - 1)) * (STARFIELD_MAX_TEMPERATURE - STARFIELD_MIN_TEMPERATURE);
        const [h, s, l] = computeStarHSL(t);
        lut.push(hslToRgb(h, s, l));
    }
    return lut;
}

/**
 * Builds the background starfield as one THREE.Points cloud.
 *
 * Positions: uniformly distributed on a spherical shell (Marsaglia's
 * method via inverse-cosine on `v`, not a naive lat/long grid, so
 * stars don't bunch up at the poles) with a little radial jitter for
 * subtle depth variation.
 *
 * Colours: each star picks a random entry from a small precomputed
 * blackbody colour LUT (see buildStarColorLUT() above) instead of
 * running the full spectral integration per star — see the
 * PERFORMANCE / STABILITY NOTE above this section for why that
 * matters.
 *
 * @param {number} count  — number of stars
 * @param {number} radius — shell radius (world units); must clear the
 *   tree sphere's radius of 30 comfortably, but — since the main
 *   camera never translates — doesn't need to be anywhere near the
 *   skybox's 100000.
 *
 * NOT added to the SelectiveBloomEffect selection: THREE.Points
 * rendered invisible once bloomed (see createStarSprite()'s comment
 * above for why) — the glow here comes entirely from the baked-in
 * halo texture plus additive blending instead. initScene() below
 * also explicitly deletes it from bloomEffect.selection, mirroring
 * the ground plane, as cheap insurance against ever being included.
 */
function createStarfield(count = 12000, radius = 400) {
    const positions = new Float32Array(count * 3);
    const colors    = new Float32Array(count * 3);
    const colorLUT  = buildStarColorLUT();

    for (let i = 0; i < count; i++) {
        // ---- Position: uniform point on a spherical shell -----------
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const phi   = Math.acos(2 * v - 1);
        const r     = radius * (0.85 + Math.random() * 0.3); // slight depth variance

        positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        // ---- Colour: random pick from the precomputed blackbody LUT --
        const [r_, g_, b_] = colorLUT[(Math.random() * colorLUT.length) | 0];

        colors[i * 3]     = r_;
        colors[i * 3 + 1] = g_;
        colors[i * 3 + 2] = b_;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size:            3,
        map:             createStarSprite(),
        vertexColors:    true,
        transparent:     true,
        depthWrite:      false,
        sizeAttenuation: false,       // constant pixel size — correct for something "infinitely far away"
        blending:        THREE.AdditiveBlending, // makes the halo texture read as a glow, and lets overlapping stars punch through brighter
    });

    const stars = new THREE.Points(geometry, material);
    stars.layers.set(0);
    stars.raycast = () => {}; // opt this object out of raycasting entirely
    stars.frustumCulled  = false; // it's a giant static shell around the camera — always visible, never worth the bounding-sphere test
    stars.matrixAutoUpdate = false; // never moves/rotates/scales after creation — skip the per-frame matrix recompute
    return stars;
}


// ============================================================
// initScene
// ============================================================
export function initScene() {

    // ---- DOM container -------------------------------------------
    AppState.container = document.getElementById('canvas');

    // ---- Scene ---------------------------------------------------
    AppState.scene = new THREE.Scene();

    // ---- Main camera (skill-tree view) ---------------------------
    // Fixed at the origin; the player navigates by rotating it.
    AppState.camera = new THREE.PerspectiveCamera(
        BASE_CAMERA_FOV,
        AppState.container.clientWidth / AppState.container.clientHeight,
        1,
        100000
    );
    AppState.camera.position.set(0, 0, 0);
    AppState.camera.rotation.order = 'YXZ'; // prevents gimbal lock for sky-looking rotations
    AppState.camera.layers.enableAll();

    // ---- Free camera (debug / exploration) -----------------------
    AppState.freeCamera = new THREE.PerspectiveCamera(
        BASE_CAMERA_FOV,
        AppState.container.clientWidth / AppState.container.clientHeight,
        0.00001,
        100000
    );
    AppState.freeCamera.position.set(0, 0, 0);
    AppState.freeCamera.rotation.order = 'YXZ';
    AppState.freeCamera.layers.enableAll();

    AppState.activeCamera = AppState.camera;

    // ---- Raycaster -----------------------------------------------
    AppState.raycaster = new THREE.Raycaster();
    AppState.mouse     = new THREE.Vector2();

    // ---- Clocks --------------------------------------------------
    AppState.clock       = new THREE.Clock(); // general per-frame delta
    AppState.cameraClock = new THREE.Clock(); // freeCameraMovement
    AppState.panclock    = new THREE.Clock(); // pan animation
    AppState.zoomclock   = new THREE.Clock(); // zoom animation
    AppState.animclock   = new THREE.Clock(); // hover animation stub (future use)

    // ---- Stats overlay (toggle with Tab) -------------------------
    AppState.stats = new Stats();

    // ---- Renderer ------------------------------------------------
    AppState.renderer = new WebGLRenderer({
        powerPreference: 'high-performance',
        antialias: false, // disabled for performance; bloom softens edges
        stencil:   false,
        depth:     false,
    });
    AppState.container.appendChild(AppState.renderer.domElement);
    AppState.renderer.setSize(AppState.container.clientWidth, AppState.container.clientHeight);
    AppState.renderer.setPixelRatio(window.devicePixelRatio);
    AppState.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ---- Post-processing pipeline: scene → RenderPass → Bloom → screen --
    AppState.composer = new EffectComposer(AppState.renderer);

    AppState.rendek = new RenderPass(AppState.scene, AppState.activeCamera);
    AppState.composer.addPass(AppState.rendek);

    AppState.bloomEffect = new SelectiveBloomEffect(AppState.scene, AppState.activeCamera, {
        intensity:           2,
        mipmapBlur:          true,
        luminanceThreshold:  0,
        luminanceSmoothing:  0.2,
        levels:              3,
        radius:              0.9,
        ignoreBackground:    true,
    });

    AppState.effectPass = new EffectPass(AppState.activeCamera, AppState.bloomEffect);
    AppState.effectPass.renderToScreen = true;
    AppState.composer.addPass(AppState.effectPass);

    // ---- Skybox (procedural gradient) ----------------------------
    // A giant inside-rendered sphere with a dark-teal-to-black gradient.
    const skyGeo = new THREE.SphereGeometry(100000, 25, 25);
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
            color1: { value: new THREE.Color(0x002f2f) }, // dark teal — horizon
                                            color2: { value: new THREE.Color(0x000000) }, // black    — zenith
        },
        vertexShader: `
        varying vec3 vPosition;
        void main() {
            vPosition   = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
        `,
        fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        varying vec3 vPosition;
        void main() {
            float gradient = (vPosition.y + 100000.0) / 200000.0;
            gradient       = smoothstep(-1.0, 1.0, gradient);
            gl_FragColor   = vec4(mix(color1, color2, gradient), 1.0);
        }
        `,
    });
    AppState.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // ---- Starfield (purely cosmetic — see createStarfield() above) --
    const starfield = createStarfield();
    AppState.scene.add(starfield);
    // Defensive/explicit — mirrors the ground plane below. Cheap insurance
    // against the starfield ever being picked up by the bloom selection.
    AppState.bloomEffect.selection.delete(starfield);

    // ---- Ground plane (grass) ------------------------------------
    // Assets live in public/, so their URL must be built from the
    // current base (see constants.js's NODE_DATA_URL for the same
    // reasoning) rather than a bare filename — a bare 'grass.jpg'
    // only resolves by accident in dev (base === '/') and 404s once
    // base becomes '/repo-name/' in a GitHub Pages build.
    const horizonTexture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}grass.jpg`);
    horizonTexture.wrapS = horizonTexture.wrapT = THREE.RepeatWrapping;
    horizonTexture.repeat.set(50, 50);

    const horizon = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50, 1, 1),
                                   new THREE.MeshBasicMaterial({
                                       map:         horizonTexture,
                                       side:        THREE.DoubleSide,
                                       transparent: false,
                                       opacity:     1.0,
                                   })
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.set(0, -1, 0);
    horizon.layers.set(0); // keep on default layer — must NOT bloom
    AppState.bloomEffect.selection.delete(horizon);
    AppState.scene.add(horizon);

    // ---- Lights --------------------------------------------------
    AppState.scene.add(new THREE.AmbientLight(0xffffff, 1));
    AppState.scene.add(new THREE.DirectionalLight(0xffffff, 2.0));

    // ---- Telescope model -----------------------------------------
    new GLTFLoader().load(
        `${import.meta.env.BASE_URL}Telescope.glb`,
        gltf => {
            AppState.scene.add(gltf.scene);
            gltf.scene.scale.set(0.05, 0.05, 0.05);
            gltf.scene.position.set(0, -1, 0);
            gltf.scene.rotation.set(0, Math.PI / 2, 0);
        },
        xhr   => console.log(`Telescope: ${(xhr.loaded / xhr.total * 100).toFixed(1)}% loaded`),
                          error => console.error('Telescope load error:', error)
    );
}
