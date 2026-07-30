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

    // ---- Skybox + procedural starfield ----------------------------
    // A giant inside-rendered sphere with a dark-teal-to-black gradient
    // AND the decorative background stars, both painted directly in
    // this ONE fragment shader, per-pixel.
    //
    // ROOT-CAUSE FIX — "stars visible only facing a certain, seemingly
    // random direction":
    // The stars used to be a separate THREE.Points cloud with a FIXED
    // number of stars (12000) scattered across the WHOLE sphere (4π
    // steradians). BASE_CAMERA_FOV is only 1° at full zoom-in (this is
    // deliberately a "looking through a telescope eyepiece" view — see
    // constants.js), and even a generously zoomed-out view only reaches
    // ~30-60°. A camera view cone that narrow covers a tiny fraction of
    // the sphere's total solid angle, so whether any given direction
    // happened to contain one of those 12000 fixed points was basically
    // a coin flip — most directions showed nothing at all, and only the
    // rare, essentially random direction that lined up with an actual
    // star showed one. (An earlier attempt fixed a real but secondary
    // depth-precision issue between the skybox and that Points cloud —
    // see depthWrite/depthTest below — but that never addressed this
    // sparse-coverage problem, which is why stars stayed effectively
    // invisible in most directions afterward.)
    //
    // The fix: stop relying on a finite, pre-placed point cloud and a
    // separate render pass entirely. Instead, generate the stars
    // PROCEDURALLY, per-pixel, from a hash of the normalized view
    // direction (`vPosition` on this giant enclosing sphere IS that
    // direction, up to scale) — directly inside the same shader that
    // already reliably paints the sky gradient in every direction. This
    // has no "count" to run out of: whatever slice of the sky is
    // actually on screen gets its own fair sampling of star cells, so
    // density no longer depends on how narrow the FOV happens to be,
    // and there's no separate object whose culling/blending/z-fighting
    // against the skybox can go wrong.
    //
    // (The skybox itself still keeps depthWrite/depthTest disabled and
    // a very low renderOrder — with near=1/far=100000 giving a
    // 100,000:1 depth ratio, this opaque, camera-enclosing sphere would
    // otherwise be able to needlessly win/lose depth tests against
    // other far-away geometry by pure floating-point rounding. Doesn't
    // matter for the stars anymore since they're part of this same
    // shader now, but it's still correct practice for a skybox and
    // costs nothing to keep.)
    const skyGeo = new THREE.SphereGeometry(100000, 25, 25);
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
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

        // Cheap 3D hash → pseudo-random float in [0, 1). Deterministic
        // per input vector, so a given sky direction always hashes to
        // the same value — this is what makes stars hold still as the
        // camera rotates instead of flickering/shifting per frame.
        float hash3(vec3 p) {
            p = fract(p * vec3(443.8975, 397.2973, 491.1871));
            p += dot(p, p.yzx + 19.19);
            return fract((p.x + p.y) * p.z);
        }

        void main() {
            float gradient = (vPosition.y + 100000.0) / 200000.0;
            gradient       = smoothstep(-1.0, 1.0, gradient);
            vec3 skyColor  = mix(color1, color2, gradient);

            // Direction from the origin (camera never translates — see
            // appState.js — so this sphere's local position already IS
            // the view direction, just scaled by the 100000-unit radius).
            vec3 dir = normalize(vPosition);

            // A 3D grid over direction-space. Multiple octaves at
            // different cell sizes give a mix of common small/dim stars
            // and rarer big/bright ones, all resolved per-pixel — no
            // fixed "star count" to be too sparse for a narrow FOV.
            float stars = 0.0;
            vec3 starColor = vec3(1.0);

            for (int i = 0; i < 3; i++) {
                float cellSize = 300.0 + float(i) * 900.0; // finer grid each octave
                vec3 cell = floor(dir * cellSize);
                float h = hash3(cell + float(i) * 13.0);
                float brightnessThreshold = 0.9975 - float(i) * 0.001; // rarer stars each octave, roughly balances density
                float b = smoothstep(brightnessThreshold, 1.0, h) * (1.0 - float(i) * 0.25);
                if (b > stars) {
                    stars = b;
                    // Warm-to-cool tint per star, from a second hash so
                    // colour doesn't correlate with brightness.
                    float tint = hash3(cell + float(i) * 13.0 + 7.0);
                    starColor = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.93, 0.8), tint);
                }
            }

            vec3 finalColor = skyColor + starColor * stars;
            gl_FragColor = vec4(finalColor, 1.0);
        }
        `,
    });
    const skyboxMesh = new THREE.Mesh(skyGeo, skyMat);
    skyboxMesh.renderOrder = -1000; // draw before everything else — see the note above
    skyboxMesh.frustumCulled = false; // camera-enclosing shell, always visible regardless of view direction
    AppState.scene.add(skyboxMesh);

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
