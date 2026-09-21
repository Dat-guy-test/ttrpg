// ============================================================
// LOADING PROGRESS
//
// Tracks weighted boot stages and drives #loadingOverlay's bar,
// spinner, and status text while the scene, node data, and star
// textures load. Percent only ever moves forward — a later stage's
// setPercent() call can never regress an earlier one.
//
// Stages (see WEIGHTS below):
//   scene      — initScene() finished (renderer/camera/skybox/lights)
//   fetch      — nodes.json fetched
//   build      — TreeNode/StarModel construction loop in treeGen()
//   textures   — every node's StarModel finishing its async texture
//                load + recolor pass — this is the dominant cost on
//                a tree with 150+ nodes, hence the largest weight
//   firstFrame — first animate() frame actually painted
//
// STALL DETECTION
// ------------------------------------------------------------
// A spinner that never stops looks identical whether loading is
// healthy or hung. setPercent() stamps `lastProgressAt` every time
// real progress is reported; a periodic check pauses/dims the
// spinner once STALL_MS has passed with no forward movement, so a
// genuine stall (dropped texture fetch, huge nodes.json, …) is
// visibly distinguishable from ordinary loading.
//
// HARD TIMEOUT FALLBACK
// ------------------------------------------------------------
// If a StarModel's texture load ever rejects (see StarModel.js's
// loadTextures().catch()), its onReady() callback never fires, so a
// naive "wait for every texture to report ready" scheme could hang
// the splash screen forever on a single bad node. main.js pairs
// this module with its own setTimeout(finishLoading, 8000) fallback
// for exactly that reason — see this module's header note below and
// main.js's sec().
//
// Exports:
//   initLoadingOverlay()                 — call once, after the DOM exists.
//   reportSceneReady()                   — call right after initScene().
//   reportFetchDone()                    — call right after nodes.json resolves.
//   reportBuildProgress(built, total)    — call periodically during the
//                                          TreeNode construction loop.
//   setTotalTextures(n)                  — call once total node count is known.
//   reportTextureReady()                 — call from each StarModel's onReady().
//   finishLoading()                      — call once everything is ready (or the
//                                          hard timeout fires); fades and removes
//                                          the overlay. Safe to call more than once.
// ============================================================

const WEIGHTS = {
    scene:      5,  // initScene() finished
    fetch:      10, // nodes.json fetched
    build:      15, // TreeNode/arc construction loop
    textures:   60, // every node's StarModel texture load + recolor — the real cost
    firstFrame: 10, // first animate() frame actually painted
};

const STALL_MS = 1200; // no forward progress for this long -> spinner visually pauses

let overlayEl, barEl, statusEl, spinnerEl;
let percent = 0;
let lastProgressAt = 0;
let stallTimer = null;
let totalTextures = 0;
let readyTextures = 0;
let finished = false; // guards finishLoading() against double-invocation (normal completion racing the hard timeout)

export function initLoadingOverlay() {
    overlayEl = document.getElementById('loadingOverlay');
    barEl     = document.getElementById('loadingBarFill');
    statusEl  = document.getElementById('loadingStatus');
    spinnerEl = overlayEl ? overlayEl.querySelector('.loading-spinner') : null;

    if (!overlayEl) {
        console.error('loadingProgress: no #loadingOverlay element found in the DOM — loading screen will not be shown.');
    }

    lastProgressAt = performance.now();
    stallTimer = setInterval(() => {
        if (!spinnerEl) return;
        const stalled = performance.now() - lastProgressAt > STALL_MS && percent < 100;
        spinnerEl.classList.toggle('loading-stalled', stalled);
    }, 300);
}

function setPercent(p, status) {
    percent = Math.max(percent, Math.min(100, p));
    lastProgressAt = performance.now();
    if (barEl) barEl.style.width = `${percent}%`;
    if (statusEl && status) statusEl.textContent = status;
    if (spinnerEl) spinnerEl.classList.remove('loading-stalled');
}

export function reportSceneReady() {
    setPercent(WEIGHTS.scene, 'Przygotowano scenę…');
}

export function reportFetchDone() {
    setPercent(WEIGHTS.scene + WEIGHTS.fetch, 'Wczytano dane drzewka…');
}

/**
 * @param {number} built — nodes constructed so far
 * @param {number} total — total nodes to construct
 */
export function reportBuildProgress(built, total) {
    const frac = total > 0 ? built / total : 1;
    setPercent(
        WEIGHTS.scene + WEIGHTS.fetch + WEIGHTS.build * frac,
        `Tworzenie węzłów… (${built}/${total})`
    );
}

/** Call once, right after the node count is known, before any StarModel reports ready. */
export function setTotalTextures(n) {
    totalTextures = n;
    readyTextures = 0;
}

/** Call from each node's StarModel.onReady() callback. */
export function reportTextureReady() {
    readyTextures = Math.min(totalTextures, readyTextures + 1);
    const frac = totalTextures > 0 ? readyTextures / totalTextures : 1;
    setPercent(
        WEIGHTS.scene + WEIGHTS.fetch + WEIGHTS.build + WEIGHTS.textures * frac,
        `Ładowanie gwiazd… (${readyTextures}/${totalTextures})`
    );
}

/** Call once the first animate() frame has actually painted. */
export function reportFirstFrame() {
    setPercent(WEIGHTS.scene + WEIGHTS.fetch + WEIGHTS.build + WEIGHTS.textures + WEIGHTS.firstFrame, 'Gotowe.');
}

/**
 * Fades and removes the overlay. Safe to call more than once — e.g.
 * once from normal completion and once from main.js's hard-timeout
 * fallback racing it; only the first call has any effect.
 */
export function finishLoading() {
    if (finished) return;
    finished = true;

    setPercent(100, statusEl && percent < 100 ? 'Kończenie ładowania…' : 'Gotowe.');
    clearInterval(stallTimer);

    if (overlayEl) {
        overlayEl.classList.add('loading-hidden');
        setTimeout(() => {
            if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        }, 700); // matches the CSS opacity transition in style.css
    }
}
