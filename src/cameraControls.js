// ============================================================
// CAMERA CONTROLS
//
// Exports:
//   computePanCamera()        — begin a pan animation
//   panCamera()               — per-frame pan interpolation
//   computeZoomCamera()       — begin a zoom animation (zooming IN;
//                               kept immediate/snappy)
//   zoomCamera()              — per-frame zoom interpolation
//   updateZoomInertia()       — per-frame momentum for zooming OUT
//                               (mouse wheel / '-' key) — see below.
//   computeInitialZoomStage() — picks a starting zoomStage based on the
//                               skill-tree window's current size/aspect.
//   freeCameraMovement()      — apply arrow-key/touch-swipe momentum to
//                               the main camera
//   freeCameraPositionUpdate()— apply WASD position movement to free camera
//
// All state (pan/zoom booleans, delta values, clocks, …) lives in
// AppState so every other module that needs to check e.g.
// AppState.panCamBool can do so without importing this file.
// ============================================================

import AppState from './appState.js';
import { BASE_CAMERA_FOV } from './constants.js';


// ============================================================
// PAN CAMERA — SETUP
// Called once to begin a smooth rotation from the current camera
// orientation to a target orientation (θ/φ on the skill sphere).
// ============================================================

/**
 * Initialises all AppState pan-animation fields and starts the clock.
 * The actual interpolation is performed each frame by panCamera().
 *
 * @param {number} iniFi — current camera.rotation.x
 * @param {number} iniTh — current camera.rotation.y
 * @param {number} finFi — target  camera.rotation.x
 * @param {number} finTh — target  camera.rotation.y
 */
export function computePanCamera(iniFi, iniTh, finFi, finTh) {
    AppState.iniPanCamFov   = AppState.camera.fov;
    AppState.panX           = iniFi;
    AppState.dPanX          = finFi - iniFi;
    AppState.panY           = iniTh;
    AppState.dPanY          = finTh - iniTh;
    AppState.panCamFov      = AppState.iniPanCamFov;
    AppState.panComputeBool = true;
    AppState.panclock.start();
}


// ============================================================
// PAN CAMERA — PER-FRAME INTERPOLATION
// Linearly interpolates camera rotation over panTime seconds.
// Also nudges the FOV proportionally to the angular distance,
// creating a subtle "dolly-then-restore" feel on larger pans.
// ============================================================

export function panCamera() {
    const panTime = 1; // seconds
    const panDT   = AppState.panclock.getElapsedTime();

    const fac = 1.5 * (Math.abs(AppState.dPanX) + Math.abs(AppState.dPanY));
    if (fac > 0.01) {
        AppState.panCamFov -= fac * (panDT - panTime / 2); // arcs in then out
        AppState.camera.fov = AppState.panCamFov;
        AppState.camera.updateProjectionMatrix();
    }

    if (panDT >= panTime) {
        // Animation complete — restore FOV and clear the running flag
        AppState.panComputeBool = false;
        AppState.panCamFov      = AppState.iniPanCamFov;
        AppState.camera.fov     = AppState.panCamFov;
        AppState.camera.updateProjectionMatrix();
        AppState.panclock.stop();
        AppState.panCamBool = false;
    }

    // Linear interpolation of camera rotation
    const t = Math.min(panDT / panTime, 1);
    AppState.camera.rotation.set(
        AppState.panX + t * AppState.dPanX,
        AppState.panY + t * AppState.dPanY,
        0
    );
}


// ============================================================
// ZOOM CAMERA — SETUP
// Called once to begin a smooth FOV change of `amount` degrees.
// Used for zooming IN (mouse wheel scroll-up / '=' key), which stays
// immediate/snappy — see updateZoomInertia() below for zooming OUT.
// ============================================================

/**
 * Initialises all AppState zoom-animation fields and starts the clock.
 * @param {number} amount — FOV delta (positive = zoom out, negative = zoom in)
 */
export function computeZoomCamera(amount) {
    AppState.zoomDelta       = amount;
    AppState.initialZoom     = AppState.camera.fov;
    AppState.finalZoom       = AppState.initialZoom + amount;
    AppState.zoomCamFov      = AppState.camera.fov;
    AppState.zoomComputeBool = true;
    AppState.zoomclock.start();
}


// ============================================================
// ZOOM CAMERA — PER-FRAME INTERPOLATION
// Linearly interpolates FOV over zoomTime seconds (very fast).
// ============================================================

export function zoomCamera() {
    const zoomTime = 0.05; // seconds
    const zoomDT   = AppState.zoomclock.getElapsedTime();

    AppState.zoomCamFov = AppState.initialZoom + (AppState.zoomDelta / zoomTime) * zoomDT;
    AppState.camera.fov = AppState.zoomCamFov;
    AppState.camera.updateProjectionMatrix();

    if (zoomDT >= zoomTime) {
        AppState.zoomComputeBool = false;
        AppState.camera.fov      = AppState.finalZoom;
        AppState.zoomCamFov      = AppState.initialZoom;
        AppState.camera.updateProjectionMatrix();
        AppState.zoomclock.stop();
        AppState.zoomCamBool = false;
    }
}


// ============================================================
// ZOOM-OUT INERTIA
// ------------------------------------------------------------
// Zooming OUT (mouse wheel scroll-down, or the '-' key — see
// inputHandlers.js) no longer jumps the FOV by a fixed step. Instead,
// each trigger adds to AppState.zoomOutVelocity (a "how many zoomStage
// units per second" momentum value), and this function — called every
// frame from main.js's animate(), the same way freeCameraMovement()
// is — advances zoomStage/FOV by that velocity and exponentially decays
// it, so a fast flick keeps gliding the view outward briefly before
// coasting to a stop, instead of a sharp, discrete jump. Zooming IN
// stays on the old immediate computeZoomCamera()/zoomCamera() path,
// since only zooming out asked for this "inertia" feel.
// ============================================================

const ZOOM_OUT_DECAY = 2.5; // 1/seconds — same exponential-decay shape as freeCameraMovement()'s arrow-key momentum

/**
 * Advances AppState.zoomStage/camera.fov by the current zoom-out
 * momentum and decays that momentum toward zero. No-op while a pan or
 * the immediate zoom-in animation is running, so they don't fight over
 * `camera.fov` in the same frame.
 * @param {number} DT — per-frame delta time, in seconds
 */
export function updateZoomInertia(DT) {
    if (AppState.panCamBool || AppState.zoomComputeBool) return;

    if (Math.abs(AppState.zoomOutVelocity) < 0.01) {
        AppState.zoomOutVelocity = 0;
        return;
    }

    const nextStage = Math.max(0, Math.min(60, AppState.zoomStage + AppState.zoomOutVelocity * DT));
    const applied   = nextStage - AppState.zoomStage;

    AppState.zoomStage   = nextStage;
    AppState.camera.fov += applied;
    AppState.camera.updateProjectionMatrix();

    if (nextStage <= 0 || nextStage >= 60) {
        AppState.zoomOutVelocity = 0; // hit a limit — nothing left to coast into
    } else {
        AppState.zoomOutVelocity -= ZOOM_OUT_DECAY * AppState.zoomOutVelocity * DT;
    }
}


// ============================================================
// INITIAL ZOOM — adapt to the skill-tree window's size
// ------------------------------------------------------------
// The skill-tree canvas (#canvas, sized via #bor/#wrap in style.css)
// can end up tall and narrow on a small/mobile screen. Since
// AppState.camera.fov is the VERTICAL field of view, a narrow aspect
// ratio (width / height) compresses the camera's effective HORIZONTAL
// field of view well below its vertical one:
//
//   horizontalFov = 2 * atan(tan(verticalFov / 2) * aspect)
//
// A node's label (see TreeNode.js) extends sideways from the node
// itself, so on a narrow-aspect viewport it can end up clipped outside
// that squeezed horizontal frustum even though the node's sphere is
// fully visible. Starting more zoomed OUT (a larger vertical FOV)
// compensates by widening the horizontal FOV too, so a whole node
// (sphere + label) stays visible on a small window. Desktop-style
// (roughly square or wider) windows are left at the normal default.
// ============================================================

const REFERENCE_ASPECT = 1.0;  // aspect ratios at/above this need no compensation
const MIN_ASPECT_FLOOR  = 0.15; // guards against a division blow-up on an extremely sliver-thin window
const ASPECT_COMPENSATION_SCALE = 16; // how fast the compensation ramps up as aspect shrinks

// zoomStage's hard bounds are [0, 60] (see updateZoomInertia()/the wheel and
// pinch handlers), but the computed compensation above is deliberately
// capped well short of that ceiling — a very narrow phone screen would
// otherwise round to something close to 60 (see the earlier, too-aggressive
// version of this function), starting the player almost fully zoomed OUT
// with nowhere left to zoom back IN. Capping at half the range instead
// guarantees at least this many zoomStage units of "room to zoom in" no
// matter how extreme the window's aspect ratio gets.
const MAX_INITIAL_ZOOM_STAGE = 30;

/**
 * Picks a starting AppState.zoomStage based on the current skill-tree
 * viewport's width/height, so a full node (and its label) is visible
 * even on a small, narrow (typically mobile) window — without eating so
 * far into the zoom range that zooming back in becomes impractical or
 * impossible. Returns 0 — the normal default — for a roughly
 * square-or-wider viewport.
 * @param {number} containerWidth  — current #canvas clientWidth, in px
 * @param {number} containerHeight — current #canvas clientHeight, in px
 * @returns {number} a zoomStage in [0, MAX_INITIAL_ZOOM_STAGE]
 */
export function computeInitialZoomStage(containerWidth, containerHeight) {
    const aspect = containerWidth / Math.max(containerHeight, 1);
    if (aspect >= REFERENCE_ASPECT) return 0;

    const compensation = (REFERENCE_ASPECT / Math.max(aspect, MIN_ASPECT_FLOOR)) - 1; // grows as the window gets narrower
    const zoomStage = Math.round(compensation * ASPECT_COMPENSATION_SCALE);
    return Math.max(0, Math.min(MAX_INITIAL_ZOOM_STAGE, zoomStage));
}


// ============================================================
// FREE CAMERA MOVEMENT — ARROW KEY / TOUCH-SWIPE MOMENTUM
// Applied to the main (skill-tree) camera each frame.
// Arrow keys AND a one-finger touch swipe (see inputHandlers.js) both
// build up cameraAcceleration; values decay multiplicatively so the
// camera glides to a stop either way — a swipe gets the exact same
// inertia feel arrow-key panning already had.
// ============================================================

export function freeCameraMovement() {
    const DT = AppState.cameraClock.getDelta();

    if (AppState.keys.ArrowUp)    { AppState.cameraAccelerationX += 1.05 * DT; }
    if (AppState.keys.ArrowDown)  { AppState.cameraAccelerationX -= 1.05 * DT; }
    if (AppState.keys.ArrowLeft)  { AppState.cameraAccelerationY += 1.05 * DT; }
    if (AppState.keys.ArrowRight) { AppState.cameraAccelerationY -= 1.05 * DT; }

    AppState.camera.rotation.x += AppState.cameraAccelerationX * DT;
    AppState.camera.rotation.y += AppState.cameraAccelerationY * DT;

    // Snap micro-drift to zero to prevent endless coasting
    if (Math.abs(AppState.cameraAccelerationX) < 0.01) AppState.cameraAccelerationX = 0;
    if (Math.abs(AppState.cameraAccelerationY) < 0.01) AppState.cameraAccelerationY = 0;

    // Exponential decay
    AppState.cameraAccelerationX -= 1.5 * AppState.cameraAccelerationX * DT;
    AppState.cameraAccelerationY -= 1.5 * AppState.cameraAccelerationY * DT;
}


// ============================================================
// FREE CAMERA POSITION — WASD / SPACE / SHIFT
// Translates the free-fly camera each frame; no momentum.
// Called from main.js's animate() loop so it runs every frame.
// ============================================================

export function freeCameraPositionUpdate() {
    const speed = 0.05;
    const k     = AppState.keys;

    if (k['w'])     { AppState.freeCamera.position.z -= speed; }
    if (k['s'])     { AppState.freeCamera.position.z += speed; }
    if (k['a'])     { AppState.freeCamera.position.x -= speed; }
    if (k['d'])     { AppState.freeCamera.position.x += speed; }
    if (k[' '])     { AppState.freeCamera.position.y += speed; }
    if (k['Shift']) { AppState.freeCamera.position.y -= speed; }
}
