// ============================================================
// CAMERA CONTROLS
//
// Exports six functions called from main.js (animate loop) and
// from inputHandlers.js (keyboard / wheel events):
//
//   computePanCamera()        — begin a pan animation
//   panCamera()               — per-frame pan interpolation
//   computeZoomCamera()       — begin a zoom animation
//   zoomCamera()              — per-frame zoom interpolation
//   freeCameraMovement()      — apply arrow-key momentum to main camera
//   freeCameraPositionUpdate()— apply WASD position movement to free camera
//
// All state (pan/zoom booleans, delta values, clocks, …) lives in
// AppState so every other module that needs to check e.g.
// AppState.panCamBool can do so without importing this file.
// ============================================================

import AppState from './appState.js';


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
// FREE CAMERA MOVEMENT — ARROW KEY MOMENTUM
// Applied to the main (skill-tree) camera each frame.
// Arrow keys build up cameraAcceleration; values decay
// multiplicatively so the camera glides to a stop.
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

