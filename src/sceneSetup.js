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
// SKY TUNING — easy-to-edit knobs
// ------------------------------------------------------------
// Globular cluster position uses the SAME fi / theta convention (degrees)
// as nodes.json and Tree.js's treeGen(): x = cosθ·cosφ, y = sinθ, z = cosθ·sinφ.
// So a cluster at fi=30, theta=20 sits in the sky exactly where a node
// with fi=30, theta=20 would. (Tree nodes span roughly fi -125..125,
// theta 4..64, so the defaults below sit just outside that.)
// ============================================================
export const CLUSTER_FI_DEG     = 180;  // longitude of the cluster centre
export const CLUSTER_THETA_DEG  = 30;   // latitude of the cluster centre
export const CLUSTER_SPAN_DEG   = 40;   // full angular diameter of the cluster
export const CLUSTER_STRENGTH   = 1.0;  // overall brightness multiplier

export const AURORA_STRENGTH    = 0.22; // 0 = off. Keep low: it is meant to be faint
export const AURORA_BASE_HEIGHT = 0.06; // sin(latitude) of the curtains' lower edge (0 = horizon, 1 = zenith)
export const AURORA_SPEED       = 2.0;  // time multiplier


// ============================================================
// GROUND TUNING — easy-to-edit knobs for the procedural ground
// ------------------------------------------------------------
// The ground is a flat plane drawn by a small shader (see "Ground
// plane" in initScene()): a faceted, low-poly-looking field of
// triangles in two dark, moody colours, fading into the horizon
// colour with distance so the plane's edge is never visible.
// ============================================================
export const GROUND_COLOR_DARK   = 0x1a4a2a; // darkest facets
export const GROUND_COLOR_LIGHT  = 0x4f8f44; // lightest facets
export const GROUND_FOG_COLOR    = 0x0a3a38; // colour the ground fades into at the horizon (≈ sky horizon)
export const GROUND_TRI_SCALE    = 1.1;      // facets per world unit (higher = smaller triangles)
export const GROUND_FOG_START    = 3.0;      // distance where the fade begins
export const GROUND_FOG_END      = 21.0;     // distance where the ground is fully faded (keep < 25, the plane's half-size)


export const GRASS_BLADE_COUNT  = 6000;     // number of low-poly blades (one draw call; 0 = no grass)
export const GRASS_MIN_RADIUS   = 1.0;       // keep blades off the spot right below the camera
export const GRASS_TIP_COLOR    = 0x8ccf5a;  // colour of blade tips


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


/** fi/theta (degrees) -> unit vector, same mapping as treeGen(). */
function fiThetaToVec3(fiDeg, thetaDeg) {
    const f = fiDeg * Math.PI / 180;
    const t = thetaDeg * Math.PI / 180;
    return new THREE.Vector3(Math.cos(t) * Math.cos(f), Math.sin(t), Math.cos(t) * Math.sin(f));
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
        intensity:           1,
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
    //
    // LAYERS PAINTED BY THIS SHADER (in order):
    //   1. sky gradient
    //   2. nebula clouds
    //   3. globular cluster (see globularCluster() — centre/size set by CLUSTER_* above)
    //   4. aurorae, animated by the `time` uniform (see aurora())
    //   5. sparse random background stars
    //
    // The `time` uniform is advanced from skyboxMesh.onBeforeRender below,
    // so no changes to main.js's animate() loop are needed.
    const skyGeo = new THREE.SphereGeometry(100000, 25, 25);

    // Cluster tangent-plane basis (camera-like frame looking at the cluster centre)
    const clusterForward = fiThetaToVec3(CLUSTER_FI_DEG, CLUSTER_THETA_DEG);
    const clusterRight   = new THREE.Vector3().crossVectors(clusterForward, new THREE.Vector3(0, 1, 0));
    if (clusterRight.lengthSq() < 1e-8) clusterRight.set(1, 0, 0);
    clusterRight.normalize();
    const clusterUp = new THREE.Vector3().crossVectors(clusterRight, clusterForward).normalize();
    const clusterTanRadius = Math.tan((CLUSTER_SPAN_DEG / 2) * Math.PI / 180);

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
                                            // ---- Time (seconds) ----
                                            time: { value: 0 },
                                            // ---- Globular cluster ----
                                            clusterForward:   { value: clusterForward },
                                            clusterRight:     { value: clusterRight },
                                            clusterUp:        { value: clusterUp },
                                            clusterTanRadius: { value: clusterTanRadius },
                                            clusterStrength:  { value: CLUSTER_STRENGTH },
                                            // ---- Aurora ----
                                            auroraStrength:   { value: AURORA_STRENGTH },
                                            auroraBaseHeight: { value: AURORA_BASE_HEIGHT },
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
        uniform float time;

        uniform vec3  clusterForward;
        uniform vec3  clusterRight;
        uniform vec3  clusterUp;
        uniform float clusterTanRadius;
        uniform float clusterStrength;

        uniform float auroraStrength;
        uniform float auroraBaseHeight;

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

        // ------------------------------------------------------------
        // GLOBULAR CLUSTER
        // The view direction is projected (gnomonic projection) onto the
        // plane tangent to the sky at the cluster centre, giving a flat 2D
        // coordinate p ~ angle in radians. A stack of grids with
        // geometrically shrinking cells is laid over p; a cell holds a star
        // with a probability that follows a King-like profile
        // 1 / (1 + (r/rc)^2), raised to a higher power for the finer
        // grids, so the core fills up with many tiny stars. Cells smaller
        // than a screen pixel fade out (the soft core glow stands in for
        // them), so the cluster stays clean when zoomed out.
        //
        // The three COARSEST grids of the original design (the big,
        // blurry / enlarged bluish stars that stood out) have been
        // removed: the loop starts at grid 3 instead of 0. To make up for
        // the lost stars, the remaining (finer) grids are populated more
        // densely, two more fine grids were added, and the unresolved-
        // starlight haze behind the stars is brighter and a bit wider.
        // ------------------------------------------------------------
        vec3 globularCluster(vec3 dir) {
            float fw = dot(dir, clusterForward);
            if (fw < 0.5) return vec3(0.0);

            vec2 p = vec2(dot(dir, clusterRight), dot(dir, clusterUp)) / fw;
            float r = length(p) / clusterTanRadius;       // 0 at centre, 1 at the rim
            if (r >= 1.0) return vec3(0.0);

            float edge = 1.0 - smoothstep(0.7, 1.0, r);   // soft outer boundary
            float dens = 1.0 / (1.0 + (r * r) / 0.06);    // core radius ~0.25 of the span (a bit wider than before)

            float pix = max(fwidth(p.x) + fwidth(p.y), 1e-7); // roughly one pixel, in p units

            // Unresolved-starlight haze: strongest in the core. Brighter than
            // before (0.16 -> 0.30) with a gentler falloff, to fill in for the
            // removed large stars.
            vec3 col = vec3(1.0, 0.88, 0.68) * 0.30 * pow(dens, 1.6) * edge;
            col += vec3(1.0, 0.90, 0.75) * 0.05 * dens * edge; // faint wide veil reaching the outskirts

            for (int i = 3; i < 9; i++) {
                float fi   = float(i);
                float k    = fi - 3.0;                       // 0 for the first (coarsest remaining) grid
                float cell = clusterTanRadius * 0.12 * pow(0.5, fi);

                float resolved = smoothstep(0.8, 2.2, cell / pix); // fade out sub-pixel layers
                if (resolved <= 0.0) continue;

                vec2 g  = p / cell;
                vec2 id = floor(g);
                vec2 f  = fract(g) - 0.5;

                vec3 seed = vec3(id, fi * 17.0 + 3.0);
                float h   = hash3(seed);
                float prob = 0.85 * pow(dens, 1.0 + 0.30 * k) * edge; // denser than before (was 0.55 / 0.45 slope, from grid 0)
                if (h >= prob) continue;

                vec2 jitter = vec2(hash3(seed + 1.7), hash3(seed + 5.3)) - 0.5;
                float d      = length(f - jitter * 0.6);
                float radius = mix(0.12, 0.26, hash3(seed + 9.1));
                float dotV   = 1.0 - smoothstep(radius * 0.3, radius, d);

                float bright = (1.0 - 0.08 * k) * mix(0.5, 1.0, hash3(seed + 2.9));
                // Warm-white tints only: the strong blue tint was what made
                // the big stars look odd, so it is toned down to a faint cool white.
                vec3 tint    = mix(vec3(1.0, 0.88, 0.70), vec3(0.92, 0.95, 1.0), hash3(seed + 7.7));
                col += tint * dotV * bright * resolved;
            }
            return col * clusterStrength;
        }

        // ------------------------------------------------------------
        // AURORA
        // Vertical "curtains": noise sampled at high frequency across the
        // horizontal plane (xz) and low frequency vertically gives
        // streaks that run up the sky; a wavy lower edge and a soft upper
        // falloff shape the band; a slowly drifting patch mask keeps it
        // from being a uniform ring. Everything scrolls/shimmers with
        // time. Sampling dir.xz directly (instead of an angle) keeps it
        // free of a longitude seam.
        // ------------------------------------------------------------
        vec3 aurora(vec3 dir) {
            if (auroraStrength <= 0.0 || dir.y < 0.0) return vec3(0.0);

            float t = time;
            vec2 xz = dir.xz;

            // Slowly drifting patches where the aurora is active
            float auroraPatch = smoothstep(0.35, 0.75, valueNoise(vec3(xz * 1.3 + vec2(t * 0.012, -t * 0.008), 7.0)));
            if (auroraPatch <= 0.0) return vec3(0.0);

            // Wavy lower edge
            float wave  = valueNoise(vec3(xz * 3.0 + vec2(t * 0.04, 0.0), t * 0.03));
            float lower = auroraBaseHeight + 0.10 * wave;
            float h     = dir.y - lower;
            float band  = smoothstep(0.0, 0.04, h) * (1.0 - smoothstep(0.08, 0.40, h));
            if (band <= 0.0) return vec3(0.0);

            // Vertical rays: fine horizontally, stretched vertically, drifting sideways
            float rays = valueNoise(vec3(xz * 26.0 + vec2(t * 0.15, 0.0), dir.y * 2.0 + t * 0.05));
            rays = pow(rays, 2.2) * 2.0;

            // Slow shimmer travelling along the curtain
            float shimmer = 0.65 + 0.35 * sin(t * 0.7 + wave * 8.0 + xz.x * 5.0);

            // Green at the bright lower edge, teal/violet higher up
            float k = clamp(h / 0.35, 0.0, 1.0);
            vec3 colLow  = vec3(0.15, 1.00, 0.45);
            vec3 colMid  = vec3(0.10, 0.75, 0.80);
            vec3 colHigh = vec3(0.60, 0.30, 0.90);
            vec3 c = k < 0.5 ? mix(colLow, colMid, k * 2.0) : mix(colMid, colHigh, (k - 0.5) * 2.0);

            return c * band * rays * shimmer * auroraPatch * auroraStrength;
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

            // ---- Globular cluster ----
            finalColor += globularCluster(dir);

            // ---- Aurorae (animated) ----
            finalColor += aurora(dir);

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

    // Drives the aurora animation. Runs whenever the skybox is drawn, so
    // main.js's animate() loop needs no changes. (Selective bloom draws the
    // scene more than once per frame; setting an absolute time is idempotent.)
    const skyClock = new THREE.Clock();
    skyboxMesh.onBeforeRender = () => {
        skyMat.uniforms.time.value = skyClock.getElapsedTime() * AURORA_SPEED;
    };

    AppState.skyMaterial = skyMat; // exposed so other modules can tweak uniforms at runtime
    AppState.scene.add(skyboxMesh);

    // NOTE: the old grass.jpg texture is no longer used anywhere — the ground
    // and grass below are 100% procedural, so grass.jpg can be deleted.
    console.info('sceneSetup: procedural ground + grass active (no grass.jpg)');

    // ---- Ground plane (procedural, low-poly look) -----------------
    // No textures: every pixel's colour comes from its world-space
    // (x, z) position. The plane is divided into a square grid and each
    // square is split along a diagonal into two triangles; each
    // triangle gets ONE flat colour from a hash of its id, which reads
    // as faceted low-poly terrain. A very low-frequency noise gently
    // varies the overall tone so it does not look like a uniform
    // pattern, and a faint lighter "ridge" line along the triangle
    // diagonals adds a hint of crisp edges. With distance the ground
    // fades into GROUND_FOG_COLOR (≈ the sky's horizon colour), so the
    // edge of the finite plane is never visible.
    const groundMat = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            colorDark:  { value: new THREE.Color(GROUND_COLOR_DARK) },
            colorLight: { value: new THREE.Color(GROUND_COLOR_LIGHT) },
            fogColor:   { value: new THREE.Color(GROUND_FOG_COLOR) },
            triScale:   { value: GROUND_TRI_SCALE },
            fogStart:   { value: GROUND_FOG_START },
            fogEnd:     { value: GROUND_FOG_END },
        },
        vertexShader: `
        varying vec3 vWorld;
        void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
        }
        `,
        fragmentShader: `
        uniform vec3  colorDark;
        uniform vec3  colorLight;
        uniform vec3  fogColor;
        uniform float triScale;
        uniform float fogStart;
        uniform float fogEnd;
        varying vec3 vWorld;

        float hash2(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
                       mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
            vec2 p  = vWorld.xz * triScale;
            vec2 g  = floor(p);
            vec2 f  = fract(p);

            // Which of the square's two triangles are we in?
            float tri = step(f.y, f.x);                       // 1 below the diagonal, 0 above
            float h   = hash2(g + tri * vec2(37.1, 11.7));    // flat value per triangle

            // Gentle large-scale tone variation (soft areas of lighter/darker ground)
            float tone = vnoise(vWorld.xz * 0.15);

            float t = clamp(0.15 + 0.55 * h + 0.45 * (tone - 0.5), 0.0, 1.0);
            vec3 col = mix(colorDark, colorLight, t);

            // Faint lighter line along the diagonal edges between facets
            float edge = 1.0 - smoothstep(0.0, 0.035, abs(f.x - f.y));
            col += colorLight * 0.10 * edge;

            // Fade into the horizon colour with distance (hides the plane's border)
            float d   = length(vWorld.xz);
            float fog = smoothstep(fogStart, fogEnd, d);
            col = mix(col, fogColor, fog);

            gl_FragColor = vec4(col, 1.0);
        }
        `,
    });

    const horizon = new THREE.Mesh(new THREE.PlaneGeometry(50, 50, 1, 1), groundMat);
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.set(0, -1, 0);
    horizon.layers.set(0); // keep on default layer — must NOT bloom
    AppState.bloomEffect.selection.delete(horizon);
    AppState.scene.add(horizon);

    // ---- Low-poly grass blades -----------------------------------
    // One single merged BufferGeometry (ONE draw call, ~18k vertices):
    // every blade is a flat triangle standing on the ground, with a
    // random position, yaw, height, width and a slight lean. Colours are
    // baked per vertex (dark at the base, lighter at the tip) and blended
    // into the ground's fog colour with distance, so far blades melt into
    // the horizon exactly like the ground shader does. Static, no
    // per-frame cost. Tune with the GRASS_* constants at the top.
    {
        const dark  = new THREE.Color(GROUND_COLOR_DARK);
        const light = new THREE.Color(GRASS_TIP_COLOR);
        const fogC  = new THREE.Color(GROUND_FOG_COLOR);
        const pos = new Float32Array(GRASS_BLADE_COUNT * 9);
        const col = new Float32Array(GRASS_BLADE_COUNT * 9);
        const base = new THREE.Color(), tip = new THREE.Color();
        const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

        for (let i = 0; i < GRASS_BLADE_COUNT; i++) {
            const r   = GRASS_MIN_RADIUS + Math.sqrt(Math.random()) * (GROUND_FOG_END - GRASS_MIN_RADIUS);
            const ang = Math.random() * Math.PI * 2;
            const cx  = Math.cos(ang) * r, cz = Math.sin(ang) * r;

            const grow = 1 + r * 0.04;                       // far blades a bit bigger so they stay visible
            const h    = (0.15 + Math.random() * 0.30) * grow;
            const w    = (0.03 + Math.random() * 0.04) * grow;
            const yaw  = Math.random() * Math.PI;
            const dx   = Math.cos(yaw) * w, dz = Math.sin(yaw) * w;
            const lx   = (Math.random() - 0.5) * 0.25 * h, lz = (Math.random() - 0.5) * 0.25 * h;
            const y0   = -1;

            const o = i * 9;
            pos.set([cx - dx, y0, cz - dz,  cx + dx, y0, cz + dz,  cx + lx, y0 + h, cz + lz], o);

            const fog = smooth(GROUND_FOG_START, GROUND_FOG_END, r);
            const shade = 0.6 + Math.random() * 0.4;
            base.copy(dark).multiplyScalar(shade).lerp(fogC, fog);
            tip.copy(dark).lerp(light, shade).lerp(fogC, fog);
            col.set([base.r, base.g, base.b,  base.r, base.g, base.b,  tip.r, tip.g, tip.b], o);
        }

        const grassGeo = new THREE.BufferGeometry();
        grassGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        grassGeo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
        const grass = new THREE.Mesh(grassGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        grass.frustumCulled = false; // camera sits at the centre of it; always visible
        grass.layers.set(0);         // default layer — must NOT bloom
        AppState.scene.add(grass);
    }

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
