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
                                            // ---- Nebula ----
                                            nebulaColorA:   { value: new THREE.Color(0xA145AD) }, // violet
                                            nebulaColorB:   { value: new THREE.Color(0x6D45AD) }, // teal-blue
                                            nebulaStrength: { value: 0.3 }, // 0 = off; tune to taste
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
        uniform vec3 nebulaColorA;
        uniform vec3 nebulaColorB;
        uniform float nebulaStrength;
        varying vec3 vPosition;

        // Cheap 3D hash → pseudo-random float in [0, 1). Deterministic
        // per input vector, so a given sky direction always hashes to
        // the same value — this is what makes stars (and now nebula
        // clouds) hold still as the camera rotates instead of
        // flickering/shifting per frame.
        float hash3(vec3 p) {
            p = fract(p * vec3(443.8975, 397.2973, 491.1871));
            p += dot(p, p.yzx + 19.19);
            return fract((p.x + p.y) * p.z);
        }

        // Smooth (trilinear-interpolated) 3D value noise — built from the
        // same hash3() above, but continuous rather than per-cell blocky,
        // which is what the nebula needs (stars deliberately stay blocky
        // per-cell, that's unrelated and untouched below).
        float valueNoise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f); // smoothstep interpolation

            float n000 = hash3(i + vec3(0.0,0.0,0.0));
            float n100 = hash3(i + vec3(1.0,0.0,0.0));
            float n010 = hash3(i + vec3(0.0,1.0,0.0));
            float n110 = hash3(i + vec3(1.0,1.0,0.0));
            float n001 = hash3(i + vec3(0.0,0.0,1.0));
            float n101 = hash3(i + vec3(1.0,0.0,1.0));
            float n011 = hash3(i + vec3(0.0,1.0,1.0));
            float n111 = hash3(i + vec3(1.0,1.0,1.0));

            float nx00 = mix(n000, n100, f.x);
            float nx10 = mix(n010, n110, f.x);
            float nx01 = mix(n001, n101, f.x);
            float nx11 = mix(n011, n111, f.x);
            float nxy0 = mix(nx00, nx10, f.y);
            float nxy1 = mix(nx01, nx11, f.y);
            return mix(nxy0, nxy1, f.z);
        }

        // Fractal Brownian Motion — several octaves of valueNoise summed
        // at increasing frequency/decreasing amplitude. A single noise
        // sample looks like blobby static; this is what gives the wispy,
        // cloud-like silhouette.
        float fbm(vec3 p) {
            float sum = 0.0;
            float amp = 0.5;
            for (int i = 0; i < 5; i++) {
                sum += amp * valueNoise(p);
                p *= 2.02; // slightly off 2.0 so octaves don't align on a grid
                amp *= 0.5;
            }
            return sum;
        }

        void main() {
            float gradient = (vPosition.y + 100000.0) / 200000.0;
            gradient       = smoothstep(-1.0, 1.0, gradient);
            vec3 skyColor  = mix(color1, color2, gradient);

            // Direction from the origin (camera never translates — see
            // appState.js — so this sphere's local position already IS
            // the view direction, just scaled by the 100000-unit radius).
            vec3 dir = normalize(vPosition);

            // ---- Nebula clouds ----
            // Sampled at a much coarser scale than the star grid so it
            // reads as smooth gas, not more stars. Domain-warping the
            // sampling coordinate through a second fbm() call (rather
            // than sampling dir directly) is what makes the cloud
            // edges look organic instead of like a plain noise contour.
            vec3 warpedDir = dir + 0.4 * vec3(
                fbm(dir * 3.0 + 5.2),
                                              fbm(dir * 3.0 + 1.3),
                                              fbm(dir * 3.0 + 8.7)
            );
            float density = fbm(warpedDir * 2.5);
            density = smoothstep(0.35, 0.85, density); // carve out clear patches of empty sky

            float tint = fbm(warpedDir * 1.6 + 50.0);
            vec3 nebulaColor = mix(nebulaColorA, nebulaColorB, tint);

            vec3 finalColor = skyColor + nebulaColor * density * nebulaStrength;

            // ---- Stars (unchanged — layered on top of the nebula) ----
            float stars = 0.0;
            vec3 starColor = vec3(1.0);
            for (int i = 0; i < 5; i++) {
                float cellSize = 200.0 + float(i) * 500.0; // finer grid each octave
                vec3 scaledDir = dir * cellSize;
                vec3 cell      = floor(scaledDir);
                vec3 localPos  = fract(scaledDir) - 0.5; // pixel's position within the cell, centered at 0
                float h = hash3(cell + float(i) * 13.0);
                float brightnessThreshold = 0.9975 - float(i) * 0.001; // rarer stars each octave
                vec3 jitter = vec3(
                    hash3(cell + float(i) * 13.0 + 3.0),
                                   hash3(cell + float(i) * 13.0 + 5.0),
                                   hash3(cell + float(i) * 13.0 + 9.0)
                ) - 0.5;
                vec3 starCenter = jitter * 0.6; // keep the center comfortably inside the cell
                float dist   = length(localPos - starCenter);
                float radius = mix(0.06, 0.22, smoothstep(brightnessThreshold, 1.0, h)); // brighter hash = bigger dot
                float circle = 1.0 - smoothstep(radius * 0.4, radius, dist); // soft circular falloff
                float isStar = step(brightnessThreshold, h);
                float b = isStar * circle * (1.0 - float(i) * 0.25);
                if (b > stars) {
                    stars = b;
                    float starTint = hash3(cell + float(i) * 13.0 + 7.0);
                    starColor = mix(vec3(0.55, 0.66, 1.0), vec3(1.0, 0.87, 0.64), starTint);
                }
            }

            finalColor += starColor * stars;
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
    //new GLTFLoader().load(
    //    `${import.meta.env.BASE_URL}Telescope.glb`,
    //    gltf => {
    //        AppState.scene.add(gltf.scene);
    //        gltf.scene.scale.set(0.05, 0.05, 0.05);
    //        gltf.scene.position.set(0, -1, 0);
    //        gltf.scene.rotation.set(0, Math.PI / 2, 0);
    //    },
    //    xhr   => console.log(`Telescope: ${(xhr.loaded / xhr.total * 100).toFixed(1)}% loaded`),
    //                      error => console.error('Telescope load error:', error)
    //);
}
