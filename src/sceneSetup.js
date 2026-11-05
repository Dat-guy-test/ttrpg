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

// Camera far plane (both cameras below). The skybox radius MUST stay
// comfortably INSIDE this — see the skybox section for why.
const CAMERA_FAR = 100000;
const SKY_RADIUS = CAMERA_FAR * 0.5;


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
        CAMERA_FAR
    );
    AppState.camera.position.set(0, 0, 0);
    AppState.camera.rotation.order = 'YXZ'; // prevents gimbal lock for sky-looking rotations
    AppState.camera.layers.enableAll();

    // ---- Free camera (debug / exploration) -----------------------
    AppState.freeCamera = new THREE.PerspectiveCamera(
        BASE_CAMERA_FOV,
        AppState.container.clientWidth / AppState.container.clientHeight,
        0.00001,
        CAMERA_FAR
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

    // ---- Skybox + procedural starfield + nebula --------------------
    // A giant inside-rendered sphere painted per-pixel by one fragment
    // shader (sky gradient, nebula clouds, procedural stars) — see the
    // shader comments below for how each layer works.
    //
    // ROOT-CAUSE FIX — "nebula partially obscured by flickering black
    // triangles on some browsers/devices":
    // The sphere used to have radius 100000 — EXACTLY the cameras' far
    // plane (see CAMERA_FAR). Every vertex of the sphere therefore sat
    // precisely ON the far clipping plane, so whether a given triangle
    // was clipped away came down to floating-point rounding in the
    // projection math. That rounding differs between GPUs, drivers and
    // browser back-ends (e.g. Firefox vs. ANGLE/D3D in Chromium vs.
    // mobile GPUs), and changes as the camera rotates — hence triangles
    // that flicker in and out, revealing the black clear colour behind
    // them. Fix: keep the sphere well INSIDE the far plane
    // (SKY_RADIUS = CAMERA_FAR / 2). The sky is camera-enclosing with
    // depth test/write disabled, so its apparent size never changes.
    //
    // Secondary hardening:
    //   - the gradient now uses the normalized view direction instead of
    //     dividing vPosition.y by a hard-coded 100000, so it no longer
    //     silently depends on the sphere's radius;
    //   - tessellation raised (25x25 -> 64x32) so flat triangles deviate
    //     less from a true sphere;
    //   - the material requests highp precision, since the hash/noise
    //     maths loses precision under mediump (default on some mobile GPUs).
    const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32);
    const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        precision: 'highp',
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
        // the same value — this is what makes stars (and nebula
        // clouds) hold still as the camera rotates.
        float hash3(vec3 p) {
            p = fract(p * vec3(443.8975, 397.2973, 491.1871));
            p += dot(p, p.yzx + 19.19);
            return fract((p.x + p.y) * p.z);
        }

        // Smooth (trilinear-interpolated) 3D value noise.
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

        // Fractal Brownian Motion — several octaves of valueNoise.
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
            // View direction (camera never translates, so the sphere's
            // local position IS the direction, up to scale).
            vec3 dir = normalize(vPosition);

            // Same 0..1 vertical value as before ((y + R) / 2R), but
            // derived from the normalized direction so it is independent
            // of the sphere's radius.
            float gradient = dir.y * 0.5 + 0.5;
            gradient       = smoothstep(-1.0, 1.0, gradient);
            vec3 skyColor  = mix(color1, color2, gradient);

            // ---- Nebula clouds ----
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

            // ---- Stars (layered on top of the nebula) ----
            float stars = 0.0;
            vec3 starColor = vec3(1.0);
            for (int i = 0; i < 5; i++) {
                float cellSize = 200.0 + float(i) * 500.0; // finer grid each octave
                vec3 scaledDir = dir * cellSize;
                vec3 cell      = floor(scaledDir);
                vec3 localPos  = fract(scaledDir) - 0.5;
                float h = hash3(cell + float(i) * 13.0);
                float brightnessThreshold = 0.9975 - float(i) * 0.001; // rarer stars each octave
                vec3 jitter = vec3(
                    hash3(cell + float(i) * 13.0 + 3.0),
                    hash3(cell + float(i) * 13.0 + 5.0),
                    hash3(cell + float(i) * 13.0 + 9.0)
                ) - 0.5;
                vec3 starCenter = jitter * 0.6;
                float dist   = length(localPos - starCenter);
                float radius = mix(0.06, 0.22, smoothstep(brightnessThreshold, 1.0, h));
                float circle = 1.0 - smoothstep(radius * 0.4, radius, dist);
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
    skyboxMesh.renderOrder = -1000; // draw before everything else
    skyboxMesh.frustumCulled = false; // camera-enclosing shell, always visible regardless of view direction
    AppState.scene.add(skyboxMesh);

    // ---- Ground plane (grass) ------------------------------------
    // Assets live in public/, so their URL must be built from the
    // current base (see constants.js's NODE_DATA_URL for the same
    // reasoning).
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
