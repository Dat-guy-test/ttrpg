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
import * as THREE from 'three';
import { WebGLRenderer } from 'three';
import { EffectComposer, EffectPass, RenderPass, SelectiveBloomEffect } from 'postprocessing';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import Stats from 'three/examples/jsm/libs/stats.module.js';

import AppState from './appState.js';
import { BLOOM_LAYER } from './constants.js';


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
