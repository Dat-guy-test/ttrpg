// ============================================================
// INPUT HANDLERS
//
// Exports one function:
//   registerInputHandlers() — attaches every DOM event listener.
//                             Call once after initScene().
//
// All state is read / written through AppState.
// Camera animation functions are imported from cameraControls.js.
//
// Listeners registered here:
//   pointermove — raycasting for hover (onPointerOver / onPointerOut)
//   click       — node activation (onClick)
//   keydown     — arrow keys (AppState.keys) + special keys (=, -, Tab, 1, 2, E, Esc)
//   keyup       — clears AppState.keys
//   wheel       — zoom in/out
//   mousedown   — begin free-camera drag
//   mouseup     — end free-camera drag
//   mousemove   — free-camera drag rotation
//   touchstart/touchmove/touchend/touchcancel (on #canvas)
//               — two-finger pinch-to-zoom, and one-finger swipe-to-pan
//                 (mirrors the wheel/arrow-key behavior for touch devices)
//   resize      — camera aspect + renderer size
// ============================================================

import AppState from './appState.js';
import { computeZoomCamera, computePanCamera } from './cameraControls.js';
import { toggleEditMode } from './editMode.js';
import { BASE_CAMERA_FOV } from './constants.js';

export function registerInputHandlers() {

    // ============================================================
    // POINTER MOVE — HOVER DETECTION
    // Raycasts every frame to find which objects are under the
    // pointer, then fires onPointerOver / onPointerOut as needed.
    // ============================================================
    window.addEventListener('pointermove', (e) => {
        if (!AppState.container.contains(e.target)) {
            // Pointer is over a UI overlay (e.g. the edit-mode panel), not the
            // 3D canvas — clear any stale hover state and skip raycasting so
            // clicks on buttons/inputs never get reinterpreted as scene clicks.
            Object.keys(AppState.hovered).forEach((key) => {
                const hoveredItem = AppState.hovered[key];
                if (hoveredItem.object.onPointerOut) hoveredItem.object.onPointerOut(hoveredItem);
                delete AppState.hovered[key];
            });
            AppState.intersects = [];
            return;
        }

        AppState.mouse.set(
            (e.offsetX / AppState.container.clientWidth)  *  2 - 1,
                           (e.offsetY / AppState.container.clientHeight) * -2 + 1
        );
        AppState.raycaster.setFromCamera(AppState.mouse, AppState.camera);
        AppState.intersects = AppState.raycaster.intersectObjects(AppState.scene.children, true);

        Object.keys(AppState.hovered).forEach((key) => {
            const stillHit = AppState.intersects.find(hit => hit.object.uuid === key);
            if (!stillHit) {
                const hoveredItem = AppState.hovered[key];
                if (hoveredItem.object.onPointerOut) hoveredItem.object.onPointerOut(hoveredItem);
                delete AppState.hovered[key];
            }
        });

        AppState.intersects.forEach((hit) => {
            if (!AppState.hovered[hit.object.uuid]) {
                AppState.hovered[hit.object.uuid] = hit;
                if (hit.object.onPointerOver) hit.object.onPointerOver(hit);
            }
            if (hit.object.onPointerMove) hit.object.onPointerMove(hit);
        });
    });

    window.addEventListener('click', (e) => {
        if (!AppState.container.contains(e.target)) return; // clicks on UI panels never hit the 3D scene
        AppState.intersects.forEach((hit) => {
            if (hit.object.onClick) hit.object.onClick(hit);
        });
    });


    // ============================================================
    // KEYDOWN
    // Two responsibilities:
    //   1. Track held keys in AppState.keys (used by freeCameraMovement
    //      and freeCameraPositionUpdate every frame).
    //   2. Handle one-shot special keys via a switch statement.
    // ============================================================
    window.addEventListener('keydown', function (e) {
        if (e.defaultPrevented) return;

        // Track the key for per-frame polling (arrow keys, WASD, Space, Shift, …)
        AppState.keys[e.key] = true;

        switch (e.key) {

            case 'Escape':
                // Debug: print camera orientation + first node angles to console
                console.log(
                    AppState.camera.rotation.x,
                    AppState.camera.rotation.y,
                    AppState.tr.nodes[0].theta,
                    AppState.tr.nodes[0].fi
                );
                break;

            case '=':
                // Zoom in — decrease FOV by one step (kept immediate/snappy)
                if (AppState.zoomStage > 0 && !AppState.zoomCamBool && !AppState.panCamBool) {
                    AppState.zoomStage   -= 1;
                    AppState.zoomCamBool  = true;
                    computeZoomCamera(-1);
                    AppState.camera.updateProjectionMatrix();
                }
                break;

            case '-':
                // Zoom out — adds momentum instead of an immediate step (see
                // cameraControls.js's updateZoomInertia(), run every frame
                // from main.js's animate()), so holding/repeatedly tapping
                // '-' keeps the view gliding outward briefly before coasting
                // to a stop, the same "inertia" feel the wheel gets below.
                if (AppState.zoomStage < 60 && !AppState.panCamBool) {
                    AppState.zoomOutVelocity = Math.min(AppState.zoomOutVelocity + 6, 40);
                }
                break;

            case 'Tab':
                // Toggle the Stats (FPS) performance overlay
                if (!AppState.statsShown) {
                    AppState.statsShown = true;
                    document.body.appendChild(AppState.stats.dom);
                }
                break;

            case '[':
                // Switch to the main skill-tree camera
                AppState.activeCamera      = AppState.camera;
                AppState.rendek.camera     = AppState.activeCamera;
                AppState.bloomEffect.camera = AppState.activeCamera;
                AppState.effectPass.camera  = AppState.activeCamera;
                console.log('Activating main camera…');
                break;

            case ']':
                // Switch to the free-fly camera
                AppState.activeCamera      = AppState.freeCamera;
                AppState.rendek.camera     = AppState.activeCamera;
                AppState.bloomEffect.camera = AppState.activeCamera;
                AppState.effectPass.camera  = AppState.activeCamera;
                console.log('Activating free camera…');
                break;

            case '`':
            case '`':
                // Toggle the skill-tree editor (edit mode + inspector panel)
                toggleEditMode();
                break;

            default:
                return; // Let unhandled keys propagate normally
        }

        e.preventDefault(); // Suppress browser default for handled keys (e.g. Tab focus-shift)
    }, true);


    // ============================================================
    // KEYUP — clear AppState.keys
    // ============================================================
    window.addEventListener('keyup', (e) => {
        AppState.keys[e.key] = false;
    });


    // ============================================================
    // MOUSE WHEEL — ZOOM
    // Each wheel tick is treated as one zoom step for zooming IN
    // (identical to pressing '='). Zooming OUT (scroll down) instead
    // adds momentum — see cameraControls.js's updateZoomInertia() —
    // so a fast scroll flick keeps gliding the view outward briefly
    // after the wheel stops, the way trackpad momentum scrolling feels.
    // ============================================================
    window.addEventListener('wheel', function (e) {
        e.preventDefault();

        if (e.deltaY < 0) {
            // Scroll up → zoom in (immediate/snappy — unchanged)
            if (AppState.zoomStage > 0 && !AppState.zoomCamBool && !AppState.panCamBool) {
                AppState.zoomStage   -= 1;
                AppState.zoomCamBool  = true;
                computeZoomCamera(-1);
                AppState.camera.updateProjectionMatrix();
            }
        } else if (e.deltaY > 0) {
            // Scroll down → zoom out, with inertia (see updateZoomInertia())
            if (!AppState.panCamBool) {
                AppState.zoomOutVelocity = Math.min(AppState.zoomOutVelocity + 6, 40);
            }
        }
    }, { passive: false }); // passive: false required so preventDefault() works


    // ============================================================
    // MOUSE DRAG — FREE CAMERA ROTATION
    // While LMB is held, horizontal/vertical mouse movement yaws
    // and pitches the free camera. Pitch is clamped to ±90°.
    // ============================================================
    window.addEventListener('mousedown', () => { AppState.isMouseDown = true; });
    window.addEventListener('mouseup',   () => { AppState.isMouseDown = false; });

    window.addEventListener('mousemove', (e) => {
        if (AppState.isMouseDown) {
            const dx = e.clientX - AppState.lastMousePosition.x;
            const dy = e.clientY - AppState.lastMousePosition.y;

            AppState.freeCamera.rotation.y -= dx * 0.005;
            AppState.freeCamera.rotation.x -= dy * 0.005;
            AppState.freeCamera.rotation.x  = Math.max(
                -Math.PI / 2,
                Math.min(Math.PI / 2, AppState.freeCamera.rotation.x)
            );
        }
        AppState.lastMousePosition = { x: e.clientX, y: e.clientY };
    });


    // ============================================================
    // TOUCH — pinch-to-zoom (2 fingers) and swipe-to-pan (1 finger)
    // ------------------------------------------------------------
    // Attached to #canvas specifically (not window) so touches over UI
    // overlays (edit-mode panel, etc.) are left alone.
    //
    // Two fingers moving apart/together directly drives AppState.zoomStage
    // /camera.fov, continuously (not stepped) — the touch equivalent of
    // the wheel, but tracked live rather than tick-by-tick.
    //
    // One finger dragging instead feeds AppState.cameraAccelerationX/Y —
    // the EXACT same momentum fields the arrow keys drive in
    // cameraControls.js's freeCameraMovement(), which already runs every
    // frame regardless of input source. That reuse is what gives a swipe
    // the same "glide to a stop" inertia arrow-key panning already has,
    // with no separate decay logic needed here.
    // ============================================================

    let pinchStartDistance  = null;
    let pinchStartZoomStage = null;
    let swipeLastX = null;
    let swipeLastY = null;

    function touchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }

    AppState.container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            pinchStartDistance      = touchDistance(e.touches);
            pinchStartZoomStage     = AppState.zoomStage;
            AppState.zoomOutVelocity = 0; // a deliberate pinch takes over from any wheel/key momentum
            swipeLastX = swipeLastY = null;
        } else if (e.touches.length === 1) {
            swipeLastX = e.touches[0].clientX;
            swipeLastY = e.touches[0].clientY;
        }
    }, { passive: true });

    AppState.container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchStartDistance) {
            e.preventDefault(); // stop the browser's own page-zoom/scroll gesture
            const ratio = pinchStartDistance / touchDistance(e.touches); // fingers spreading apart (zoom in) -> ratio < 1
            const targetStage = pinchStartZoomStage + (ratio - 1) * 60;
            AppState.zoomStage  = Math.max(0, Math.min(60, targetStage));
            AppState.camera.fov = BASE_CAMERA_FOV + AppState.zoomStage;
            AppState.camera.updateProjectionMatrix();

        } else if (e.touches.length === 1 && swipeLastX !== null && !AppState.panCamBool) {
            e.preventDefault();
            const dx = e.touches[0].clientX - swipeLastX;
            const dy = e.touches[0].clientY - swipeLastY;
            swipeLastX = e.touches[0].clientX;
            swipeLastY = e.touches[0].clientY;

            const TOUCH_PAN_SENSITIVITY = 0.003; // tuned so a typical swipe feels comparable to a couple of arrow-key taps
            AppState.cameraAccelerationX -= dy * TOUCH_PAN_SENSITIVITY;
            AppState.cameraAccelerationY -= dx * TOUCH_PAN_SENSITIVITY;
        }
    }, { passive: false });

    AppState.container.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            pinchStartDistance  = null;
            pinchStartZoomStage = null;
        }
        if (e.touches.length === 0) {
            swipeLastX = swipeLastY = null;
        } else if (e.touches.length === 1) {
            // Dropped from two fingers to one — restart swipe tracking from here
            // instead of using the stale two-finger position on the next move.
            swipeLastX = e.touches[0].clientX;
            swipeLastY = e.touches[0].clientY;
        }
    }, { passive: true });

    AppState.container.addEventListener('touchcancel', () => {
        pinchStartDistance  = null;
        pinchStartZoomStage = null;
        swipeLastX = swipeLastY = null;
    }, { passive: true });


    // ============================================================
    // WINDOW RESIZE
    // Updates camera aspect ratio and renderer dimensions.
    // ============================================================
    window.addEventListener('resize', () => {
        AppState.activeCamera.aspect =
        AppState.container.clientWidth / AppState.container.clientHeight;
        AppState.activeCamera.updateProjectionMatrix();
        AppState.renderer.setSize(
            AppState.container.clientWidth,
            AppState.container.clientHeight
        );
        AppState.renderer.setPixelRatio(window.devicePixelRatio);
    });
}
