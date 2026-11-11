// ============================================================
// PERFORMANCE TUNING  (low-UX-impact quality/performance trade-offs)
//
// Everything here trades a small amount of visual fidelity for GPU/CPU
// time. Every knob is an exported constant below — set it back to the
// "original" value in the comment to restore the previous look.
//
// This module deliberately patches the objects sceneSetup.js creates
// (renderer, bloom effect, grass mesh, sky shader) instead of editing
// sceneSetup.js, so it can be removed by deleting the two calls in
// main.js: applyPerformanceTuning() and updatePerformanceTuning().
// Every patch is defensive: if the object/pattern it expects isn't
// found (e.g. sceneSetup.js was edited) it logs a warning and leaves
// that part untouched.
//
// Imports only appState.js, so any module may import it without cycles.
// ============================================================

import AppState from './appState.js';

// ---- Knobs -------------------------------------------------------------

/** Cap on renderer pixel ratio. Original: window.devicePixelRatio (uncapped). */
export const MAX_PIXEL_RATIO = 1.5;

/** Grass blades actually drawn. sceneSetup.js generates GRASS_BLADE_COUNT (6000); blades are uniformly random so drawing the first N is a uniform thinning. Original: 6000. */
export const GRASS_VISIBLE_BLADES = 2500;

/** Bloom mip-blur levels. Original: 3. */
export const BLOOM_LEVELS = 2;

/** Sky nebula fbm octaves at normal zoom. Original: 5. */
export const NEBULA_OCTAVES = 3;
/** Sky nebula fbm octaves while the camera FOV is below NEBULA_ZOOM_FOV (fine octaves are sub-pixel-smooth there anyway). */
export const NEBULA_OCTAVES_ZOOMED = 2;
export const NEBULA_ZOOM_FOV = 8;

/** Upper bound (exclusive) of the globular cluster's finest-grid loop. Original: 9 (grids 3..8). */
export const CLUSTER_GRID_END = 8;


// ---- Pixel ratio ---------------------------------------------------------

/** The pixel ratio the renderer should use. Also used by inputHandlers.js's resize handler. */
export function getRenderPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}

function applyPixelRatio() {
    const renderer = AppState.renderer;
    if (!renderer) return;
    renderer.setPixelRatio(getRenderPixelRatio());
    // The postprocessing buffers must match the new drawing-buffer size.
    try { AppState.composer.setSize(); } catch (e) { console.warn('performanceTuning: composer.setSize() failed.', e); }
}


// ---- Grass --------------------------------------------------------------

function applyGrassThinning() {
    const grass = AppState.scene.children.find(o =>
        o.isMesh && o.material && o.material.vertexColors && o.geometry && o.geometry.attributes.color
    );
    if (!grass) {
        console.warn('performanceTuning: grass mesh not found — leaving it untouched.');
        return;
    }
    const totalVertices = grass.geometry.attributes.position.count;
    const wanted = Math.min(totalVertices, GRASS_VISIBLE_BLADES * 3); // 3 vertices per blade
    grass.geometry.setDrawRange(0, wanted);
}


// ---- Bloom ---------------------------------------------------------------

function applyBloomLevels() {
    const bloom = AppState.bloomEffect;
    if (!bloom) return;
    try {
        if ('levels' in bloom) bloom.levels = BLOOM_LEVELS;
        else console.warn('performanceTuning: bloomEffect.levels not available in this postprocessing version.');
    } catch (e) {
        console.warn('performanceTuning: could not set bloom levels.', e);
    }
}


// ---- Sky shader ---------------------------------------------------------------

/** Replaces the first match of `regex` in `src`; returns null if there is none. */
function replaceOnce(src, regex, replacement) {
    return regex.test(src) ? src.replace(regex, replacement) : null;
}

/**
 * Patches sceneSetup.js's sky fragment shader (exposed as AppState.skyMaterial):
 *   - fbm() gets a runtime octave count (uniform fbmOctaves) and is
 *     re-normalised so the nebula keeps its overall density;
 *   - the cluster's finest grid(s) are dropped (CLUSTER_GRID_END).
 * All-or-nothing: if any pattern isn't found, nothing is changed.
 */
function patchSkyShader() {
    const mat = AppState.skyMaterial;
    if (!mat || typeof mat.fragmentShader !== 'string') {
        console.warn('performanceTuning: AppState.skyMaterial not found — sky shader untouched.');
        return;
    }

    let src = mat.fragmentShader;
    const steps = [
        [/(uniform float nebulaStrength;)/,
            '$1\n        uniform int fbmOctaves;'],
        [/(float amp = 0\.5;\s*for \(int i = 0; i < 5; i\+\+\) \{)/,
            '$1\n                if (i >= fbmOctaves) break;'],
        [/return sum;/,
            'return sum * 0.96875 / (1.0 - pow(0.5, float(fbmOctaves)));'], // 0.96875 = 1 - 0.5^5 (the original 5-octave total amplitude)
        [/for \(int i = 3; i < 9; i\+\+\)/,
            `for (int i = 3; i < ${CLUSTER_GRID_END}; i++)`],
    ];

    for (const [regex, replacement] of steps) {
        const next = replaceOnce(src, regex, replacement);
        if (next === null) {
            console.warn(`performanceTuning: sky shader pattern ${regex} not found — sky shader left untouched.`);
            return;
        }
        src = next;
    }

    mat.fragmentShader = src;
    mat.uniforms.fbmOctaves = { value: NEBULA_OCTAVES };
    mat.needsUpdate = true;
}

let lastOctaves = NEBULA_OCTAVES;

/** Per-frame: fewer nebula octaves while zoomed in. Cheap (one compare). */
export function updatePerformanceTuning() {
    const mat = AppState.skyMaterial;
    if (!mat || !mat.uniforms.fbmOctaves) return;
    const wanted = AppState.camera.fov < NEBULA_ZOOM_FOV ? NEBULA_OCTAVES_ZOOMED : NEBULA_OCTAVES;
    if (wanted !== lastOctaves) {
        lastOctaves = wanted;
        mat.uniforms.fbmOctaves.value = wanted;
    }
}


// ---- Entry point -------------------------------------------------------------------

/** Call once, right after initScene(). */
export function applyPerformanceTuning() {
    applyPixelRatio();
    applyGrassThinning();
    applyBloomLevels();
    patchSkyShader();
}
