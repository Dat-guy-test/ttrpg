// ============================================================
// StarModel
//
// Animated lava-shader material applied to a skill node's star mesh
// when that node is activated.
//
// PERFORMANCE DESIGN (replaces the one-texture-set-per-node version)
// ------------------------------------------------------------
// The old implementation made EVERY node (150+) load sun.jpg and
// cloud.png itself, run a full-resolution per-pixel HSL recolour on a
// canvas, and build its own ShaderMaterial — all at boot, on the main
// thread. Now:
//
//   1. sun.jpg / cloud.png are loaded ONCE and shared by every star.
//   2. The recoloured texture + ShaderMaterial are built ONCE PER
//      DISTINCT TEMPERATURE (many nodes share 6000 K) and shared.
//   3. The recolour pass uses a 766-entry lookup table instead of an
//      HSL->RGB conversion per pixel. The index is the exact channel
//      sum, so the output is bit-identical to the old per-pixel maths.
//   4. A StarModel is "ready" as soon as the shared base images have
//      loaded (this is what the loading overlay waits for). The costly
//      recolour is built lazily the first time `customMaterial` is read
//      (node activation) and is PRE-WARMED during browser idle time, so
//      activating a perk normally never stalls.
//   5. Because materials are shared, `time` must be advanced once per
//      distinct material, not once per StarModel — see advanceStarTime().
//
// StarModel stays AppState-free (it never touches the scene/camera).
// ============================================================

import * as THREE from 'three';
import { computeStarHSL, hslToRgb } from './colorScience.js';

// Shader animation parameters (become GLSL uniforms)
const PARAMS = {
    baseSpeed:   0.0001, // speed of base texture UV scroll
    repeatS:     1.0,    // UV tiling — S axis
    repeatT:     1.0,    // UV tiling — T axis
    noiseScale:  0.9,    // distortion strength applied by the noise layer
    blendSpeed:  0.03,   // speed of secondary (blend) texture scroll
    blendOffset: 0.6,    // brightness subtracted from the blend layer
    bumpSpeed:   0.06,   // speed of the vertex-displacement texture scroll
    bumpScale:   0.0025, // magnitude of per-vertex displacement
};

const VERTEX_SHADER = `
    uniform sampler2D noiseTexture;
    uniform float     noiseScale;
    uniform sampler2D bumpTexture;
    uniform float     bumpSpeed;
    uniform float     bumpScale;
    uniform float     time;
    varying vec2 vUv;

    void main() {
        vUv = uv;

        vec2 uvTimeShift = vUv + vec2(1.1, 1.9) * time * bumpSpeed;
        vec4 noiseGeneratorTimeShift = texture2D(noiseTexture, uvTimeShift);
        vec4 bumpData = texture2D(bumpTexture, uvTimeShift);

        // At UV poles the texture degenerates; use a simple sinusoidal wobble instead
        float displacement = (vUv.y > 0.999 || vUv.y < 0.001)
        ? bumpScale * (0.3 + 0.02 * sin(time))
        : bumpScale * bumpData.r;

        vec3 newPosition = position + normal * displacement;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
`;

const FRAGMENT_SHADER = `
    uniform sampler2D baseTexture;
    uniform float     baseSpeed;
    uniform float     repeatS;
    uniform float     repeatT;
    uniform sampler2D noiseTexture;
    uniform float     noiseScale;
    uniform sampler2D blendTexture;
    uniform float     blendSpeed;
    uniform float     blendOffset;
    uniform float     time;
    uniform float     alpha;
    varying vec2 vUv;

    void main() {
        // Base layer: scroll in one direction, distort through noise r/b channels
        vec2 uvTimeShift  = vUv + vec2(-0.7, 1.5) * time * baseSpeed;
        vec4 noise1       = texture2D(noiseTexture, uvTimeShift);
        vec2 uvNoise1     = vUv + noiseScale * vec2(noise1.r, noise1.b);
        vec4 baseColor    = texture2D(baseTexture, uvNoise1 * vec2(repeatS, repeatT));

        // Blend layer: scroll in opposite direction, distort through noise g/b channels
        vec2 uvTimeShift2 = vUv + vec2(1.3, -1.7) * time * blendSpeed;
        vec4 noise2       = texture2D(noiseTexture, uvTimeShift2);
        vec2 uvNoise2     = vUv + noiseScale * vec2(noise2.g, noise2.b);
        vec4 blendColor   = texture2D(blendTexture, uvNoise2 * vec2(repeatS, repeatT))
        - blendOffset * vec4(1.0);

        vec4 theColor = baseColor + blendColor;
        theColor.a    = alpha;
        gl_FragColor  = theColor;
    }
`;


// ------------------------------------------------------------
// Shared caches
// ------------------------------------------------------------

let baseAssetsPromise = null;
let baseAssets = null;            // { lava: THREE.Texture, noise: THREE.Texture } once loaded
const materialCache = new Map();  // temperature -> { uniforms, material }
let loggedLoadFailure = false;

function loadTexture(url) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(
            url,
            tex => resolve(tex),
            undefined,
            () => reject(new Error(`StarModel: failed to load texture "${url}"`))
        );
    });
}

/** Loads sun.jpg + cloud.png exactly once for the whole app. */
function loadBaseAssets() {
    if (!baseAssetsPromise) {
        baseAssetsPromise = Promise.all([
            loadTexture(`${import.meta.env.BASE_URL}sun.jpg`),
            loadTexture(`${import.meta.env.BASE_URL}cloud.png`),
        ]).then(([lava, noise]) => {
            noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
            baseAssets = { lava, noise };
            return baseAssets;
        });
    }
    return baseAssetsPromise;
}

/**
 * Recolours sun.jpg for one blackbody temperature. Every pixel's hue and
 * saturation are replaced by the star's, and lightness is scaled by the
 * pixel's original greyscale brightness (so all surface detail survives).
 *
 * The brightness of a pixel is (r+g+b)/3/255, i.e. fully determined by the
 * integer channel sum 0..765 — so the HSL->RGB result is precomputed once
 * per sum instead of once per pixel.
 * @returns {THREE.CanvasTexture}
 */
function buildRecolouredTexture(temperature) {
    const image  = baseAssets.lava.image;
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    canvas.width  = image.width;
    canvas.height = image.height;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const [h, s, l] = computeStarHSL(temperature);

    const lut = new Uint8ClampedArray(766 * 3);
    for (let sum = 0; sum <= 765; sum++) {
        const bri = (sum / 3) / 255;
        const [r, g, b] = hslToRgb(h, s, l * bri);
        lut[sum * 3]     = Math.floor(255 * r);
        lut[sum * 3 + 1] = Math.floor(255 * g);
        lut[sum * 3 + 2] = Math.floor(255 * b);
    }

    for (let i = 0; i < data.length; i += 4) {
        const k = (data[i] + data[i + 1] + data[i + 2]) * 3;
        data[i]     = lut[k];
        data[i + 1] = lut[k + 1];
        data[i + 2] = lut[k + 2];
        // alpha (data[i+3]) intentionally unchanged
    }

    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

/** Returns (building it first if needed) the shared uniforms + material for a temperature. Requires baseAssets. */
function getMaterialEntry(temperature) {
    let entry = materialCache.get(temperature);
    if (entry) return entry;

    const lava = buildRecolouredTexture(temperature);
    const uniforms = {
        baseTexture:  { value: lava },
        baseSpeed:    { value: PARAMS.baseSpeed },
        repeatS:      { value: PARAMS.repeatS },
        repeatT:      { value: PARAMS.repeatT },
        noiseTexture: { value: baseAssets.noise },
        noiseScale:   { value: PARAMS.noiseScale },
        blendTexture: { value: lava },              // blend reuses the coloured surface
        blendSpeed:   { value: PARAMS.blendSpeed },
        blendOffset:  { value: PARAMS.blendOffset },
        bumpTexture:  { value: baseAssets.noise },  // bump reuses noise
        bumpSpeed:    { value: PARAMS.bumpSpeed },
        bumpScale:    { value: PARAMS.bumpScale },
        alpha:        { value: 1.0 },
        time:         { value: 1.0 },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
    });
    material.transparent = true;
    material.opacity     = 0.9;
    material.needsUpdate = true;

    entry = { uniforms, material };
    materialCache.set(temperature, entry);
    return entry;
}


// ------------------------------------------------------------
// Idle pre-warming — builds the recoloured textures one at a time
// when the browser has nothing better to do, so that activating a
// perk finds its material already built.
// ------------------------------------------------------------

const prewarmQueue = [];
const prewarmQueued = new Set();
let prewarmRunning = false;

const scheduleIdle = (typeof requestIdleCallback === 'function')
    ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 30);

function pumpPrewarm(deadline) {
    // Always do at least one, then keep going while the idle slice lasts.
    do {
        const temperature = prewarmQueue.shift();
        if (temperature !== undefined && baseAssets) getMaterialEntry(temperature);
    } while (prewarmQueue.length && deadline.timeRemaining() > 8);

    if (prewarmQueue.length) scheduleIdle(pumpPrewarm);
    else prewarmRunning = false;
}

function queuePrewarm(temperature) {
    if (materialCache.has(temperature) || prewarmQueued.has(temperature)) return;
    prewarmQueued.add(temperature);
    prewarmQueue.push(temperature);
    if (!prewarmRunning) {
        prewarmRunning = true;
        scheduleIdle(pumpPrewarm);
    }
}

/**
 * Advances the shader clock. Materials are shared between StarModels, so
 * this must be called ONCE per frame (main.js's animate()) rather than
 * incrementing `customUniforms.time` per StarModel.
 * @param {number} delta — seconds since the previous frame
 */
export function advanceStarTime(delta) {
    for (const { uniforms } of materialCache.values()) {
        uniforms.time.value += delta;
    }
}


export class StarModel {
    /**
     * @param {number} temperature - Blackbody temperature in Kelvin
     *                               (e.g. 3000 K = red-orange, 10 000 K = blue-white)
     */
    constructor(temperature) {
        this.temperature = temperature;
        this.isReady = false; // true once the shared base images are loaded
        this._readyCallbacks = [];

        loadBaseAssets()
        .then(() => {
            this.isReady = true;
            const callbacks = this._readyCallbacks;
            this._readyCallbacks = [];
            callbacks.forEach(cb => cb());
            queuePrewarm(this.temperature);
        })
        .catch(err => {
            if (!loggedLoadFailure) {
                loggedLoadFailure = true;
                console.error('StarModel: error loading textures:', err);
            }
        });
    }

    /**
     * Runs `callback` once `customMaterial` can be read (immediately if it
     * already can). Exists because assigning `.customMaterial` to a mesh
     * before the base textures exist would set that mesh's material to
     * `undefined` and crash the renderer (see TreeNode._applyActiveStarVisual()).
     * @param {() => void} callback
     */
    onReady(callback) {
        if (this.isReady) callback();
        else this._readyCallbacks.push(callback);
    }

    /** Shared ShaderMaterial for this star's temperature (built on first read). undefined until isModelReady(). */
    get customMaterial() {
        return this.isReady ? getMaterialEntry(this.temperature).material : undefined;
    }

    /** Shared uniforms object for this star's temperature. undefined until isModelReady(). */
    get customUniforms() {
        return this.isReady ? getMaterialEntry(this.temperature).uniforms : undefined;
    }

    /** True once customMaterial can safely be read. */
    isModelReady() { return this.isReady; }
}
