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
import * as THREE from 'three';
import { WebGLRenderer } from 'three';
import { EffectComposer, EffectPass, RenderPass, SelectiveBloomEffect } from 'postprocessing';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import AppState from './appState.js';
import { BLOOM_LAYER } from './constants.js';
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
// ============================================================

const STARFIELD_MIN_TEMPERATURE = 1000;  // Kelvin — deep red
const STARFIELD_MAX_TEMPERATURE = 10000; // Kelvin — blue-white

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
 * Builds the background starfield as one THREE.Points cloud.
 *
 * Positions: uniformly distributed on a spherical shell (Marsaglia's
 * method via inverse-cosine on `v`, not a naive lat/long grid, so
 * stars don't bunch up at the poles) with a little radial jitter for
 * subtle depth variation.
 *
 * Colours: EACH star gets its own random temperature in
 * [STARFIELD_MIN_TEMPERATURE, STARFIELD_MAX_TEMPERATURE], run through
 * colorScience.js's computeStarHSL()/hslToRgb() — the exact same
 * Planck-spectrum → CIE XYZ → RGB pipeline StarModel.js uses to tint
 * an activated perk node. This is a one-time cost at scene-build time
 * (not per-frame): computeStarHSL() internally integrates an 81-sample
 * spectrum, so `count` stars costs roughly `count * 81` cheap
 * arithmetic ops once, then never runs again.
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
 * halo texture plus additive blending instead.
 */
function createStarfield(count = 12000, radius = 400) {
    const positions = new Float32Array(count * 3);
    const colors    = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        // ---- Position: uniform point on a spherical shell -----------
        const u = Math.random(), v = Math.random();
        const theta = u * Math.PI * 2;
        const phi   = Math.acos(2 * v - 1);
        const r     = radius * (0.85 + Math.random() * 0.3); // slight depth variance

        positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        // ---- Colour: randomised blackbody temperature ----------------
        const temperature = STARFIELD_MIN_TEMPERATURE
            + Math.random() * (STARFIELD_MAX_TEMPERATURE - STARFIELD_MIN_TEMPERATURE);
        const [h, s, l]  = computeStarHSL(temperature);
        const [r_, g_, b_] = hslToRgb(h, s, l);

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
    stars.layers.set(0); // default layer — deliberately NOT bloomed, see the header comment above
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
        30,
        AppState.container.clientWidth / AppState.container.clientHeight,
        1,
        100000
    );
    AppState.camera.position.set(0, 0, 0);
    AppState.camera.rotation.order = 'YXZ'; // prevents gimbal lock for sky-looking rotations
    AppState.camera.layers.enableAll();

    // ---- Free camera (debug / exploration) -----------------------
    AppState.freeCamera = new THREE.PerspectiveCamera(
        30,
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
    AppState.scene.add(createStarfield());

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
