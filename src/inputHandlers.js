// ============================================================
// INPUT HANDLERS
//
// Exports registerInputHandlers() — attaches every DOM event listener.
// Call once after initScene(). State lives in AppState; camera
// animation functions come from cameraControls.js.
//
// Listeners: pointermove (hover raycast), click (node activation),
// keydown/keyup, wheel (zoom), mouse drag (free camera), touch
// (pinch-zoom / swipe-pan), resize.
//
// PERFORMANCE NOTES (changes vs. the previous version)
//   - Hover raycasting used to run on EVERY pointermove event against
//     `scene.children` recursively — i.e. also the skybox sphere, the
//     ground, the 6000-triangle grass mesh, ~200 arc lines (with
//     Line.threshold = 1 on a radius-30 sphere!) and ~170 text meshes,
//     none of which have any handler. It now:
//       1. tests ONLY the objects that actually have handlers
//          (nodes, requirement click-tubes, the tree sphere) — see
//          buildPickTargets(); and
//       2. coalesces pointer movement to at most one raycast per
//          animation frame (high-poll-rate mice fire >100 events/s).
//     A click flushes any pending move first, so the object under the
//     cursor at click time is exactly what it was before.
// ============================================================

import AppState from './appState.js';
import { computePanCamera } from './cameraControls.js';
import { toggleEditMode } from './editMode.js';
import { BASE_CAMERA_FOV } from './constants.js';
import { getRenderPixelRatio } from './performanceTuning.js';

export function registerInputHandlers() {

    // ============================================================
    // POINTER MOVE — HOVER DETECTION (one raycast per frame)
    // ============================================================

    let pendingPointer = null; // {x, y} of the latest unprocessed pointermove
    let pointerRafId   = 0;

    /** Everything in the scene that has an onClick / onPointerOver handler. */
    function buildPickTargets() {
        const targets = [];
        const tr = AppState.tr;
        if (!tr) return targets;
        if (tr.treesphere) targets.push(tr.treesphere);
        for (const node of tr.nodes) {
            targets.push(node);
            for (const pair of node.reqTubes) targets.push(pair[0], pair[1]);
        }
        return targets;
    }

    function clearHoverState() {
        Object.keys(AppState.hovered).forEach((key) => {
            const hoveredItem = AppState.hovered[key];
            if (hoveredItem.object.onPointerOut) hoveredItem.object.onPointerOut(hoveredItem);
            delete AppState.hovered[key];
        });
    }

    function updateHover(x, y) {
        AppState.mouse.set(
            (x / AppState.container.clientWidth)  *  2 - 1,
            (y / AppState.container.clientHeight) * -2 + 1
        );
        AppState.raycaster.setFromCamera(AppState.mouse, AppState.camera);
        AppState.intersects = AppState.raycaster.intersectObjects(buildPickTargets(), false);

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
    }

    function flushPointer() {
        pointerRafId = 0;
        if (!pendingPointer) return;
        const { x, y } = pendingPointer;
        pendingPointer = null;
        updateHover(x, y);
    }

    window.addEventListener('pointermove', (e) => {
        if (!AppState.container.contains(e.target)) {
            // Pointer is over a UI overlay, not the 3D canvas — clear stale
            // hover state and skip raycasting so UI clicks never reach the scene.
            pendingPointer = null;
            clearHoverState();
            AppState.intersects = [];
            return;
        }
        pendingPointer = { x: e.offsetX, y: e.offsetY };
        if (!pointerRafId) pointerRafId = requestAnimationFrame(flushPointer);
    });

    window.addEventListener('click', (e) => {
        if (!AppState.container.contains(e.target)) return; // clicks on UI panels never hit the 3D scene
        if (pendingPointer) {            // make sure intersects reflects the latest cursor position
            cancelAnimationFrame(pointerRafId);
            flushPointer();
        }
        AppState.intersects.forEach((hit) => {
            if (hit.object.onClick) hit.object.onClick(hit);
        });
    });


    // ============================================================
    // KEYDOWN
    // ============================================================
    window.addEventListener('keydown', function (e) {
        if (e.defaultPrevented) return;

        AppState.keys[e.key] = true;

        switch (e.key) {

            case 'Escape':
                console.log(
                    AppState.camera.rotation.x,
                    AppState.camera.rotation.y,
                    AppState.tr.nodes[0].theta,
                    AppState.tr.nodes[0].fi
                );
                break;

            case '=':
            case '+':
                // Zoom in with inertia (see cameraControls.js's updateZoomInertia()).
                if (AppState.zoomStage > 0 && !AppState.panCamBool) {
                    // A deliberate zoom-in takes over from leftover outward momentum.
                    if (AppState.zoomVelocity > 0) AppState.zoomVelocity = 0;
                    AppState.zoomVelocity = Math.max(AppState.zoomVelocity - 6, -40);
                }
                break;

            case '-':
                // Zoom out with inertia.
                if (AppState.zoomStage < 60 && !AppState.panCamBool) {
                    if (AppState.zoomVelocity < 0) AppState.zoomVelocity = 0;
                    AppState.zoomVelocity = Math.min(AppState.zoomVelocity + 6, 40);
                }
                break;

            case 'Tab':
                if (!AppState.statsShown) {
                    AppState.statsShown = true;
                    document.body.appendChild(AppState.stats.dom);
                }
                break;

            case '[':
                AppState.activeCamera      = AppState.camera;
                AppState.rendek.camera     = AppState.activeCamera;
                AppState.bloomEffect.camera = AppState.activeCamera;
                AppState.effectPass.camera  = AppState.activeCamera;
                console.log('Activating main camera…');
                break;

            case ']':
                AppState.activeCamera      = AppState.freeCamera;
                AppState.rendek.camera     = AppState.activeCamera;
                AppState.bloomEffect.camera = AppState.activeCamera;
                AppState.effectPass.camera  = AppState.activeCamera;
                console.log('Activating free camera…');
                break;
            case '~':
                toggleEditMode();
                break;

            default:
                return; // Let unhandled keys propagate normally
        }

        e.preventDefault();
    }, true);


    window.addEventListener('keyup', (e) => {
        AppState.keys[e.key] = false;
    });


    // ============================================================
    // MOUSE WHEEL — ZOOM (only over the 3D canvas, so panels scroll natively)
    // ============================================================
    window.addEventListener('wheel', function (e) {
        if (!AppState.container.contains(e.target)) return;
        e.preventDefault();

        if (e.deltaY < 0) {
            if (AppState.zoomStage > 0 && !AppState.panCamBool) {
                if (AppState.zoomVelocity > 0) AppState.zoomVelocity = 0;
                AppState.zoomVelocity = Math.max(AppState.zoomVelocity - 6, -40);
            }
        } else if (e.deltaY > 0) {
            if (AppState.zoomStage < 60 && !AppState.panCamBool) {
                if (AppState.zoomVelocity < 0) AppState.zoomVelocity = 0;
                AppState.zoomVelocity = Math.min(AppState.zoomVelocity + 6, 40);
            }
        }
    }, { passive: false });


    // ============================================================
    // MOUSE DRAG — FREE CAMERA ROTATION
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
    // Attached to #canvas so touches over UI overlays are left alone.
    // A one-finger touch only counts as a swipe past SWIPE_DRAG_THRESHOLD,
    // so ordinary taps still reach the click handler.
    // ============================================================

    let pinchStartDistance  = null;
    let pinchStartZoomStage = null;
    let touchStartX = null;
    let touchStartY = null;
    let swipeLastX  = null;
    let swipeLastY  = null;
    let isSwiping   = false;

    const SWIPE_DRAG_THRESHOLD = 10; // px

    function touchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }

    function resetSwipeTracking() {
        touchStartX = touchStartY = null;
        swipeLastX  = swipeLastY  = null;
        isSwiping   = false;
    }

    AppState.container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            pinchStartDistance      = touchDistance(e.touches);
            pinchStartZoomStage     = AppState.zoomStage;
            AppState.zoomVelocity = 0;
            resetSwipeTracking();
        } else if (e.touches.length === 1) {
            touchStartX = swipeLastX = e.touches[0].clientX;
            touchStartY = swipeLastY = e.touches[0].clientY;
            isSwiping   = false;
        }
    }, { passive: true });

    AppState.container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchStartDistance) {
            e.preventDefault();
            const ratio = pinchStartDistance / touchDistance(e.touches);
            const targetStage = pinchStartZoomStage + (ratio - 1) * 60;
            AppState.zoomStage  = Math.max(0, Math.min(60, targetStage));
            AppState.camera.fov = BASE_CAMERA_FOV + AppState.zoomStage;
            AppState.camera.updateProjectionMatrix();

        } else if (e.touches.length === 1 && swipeLastX !== null && !AppState.panCamBool) {
            const clientX = e.touches[0].clientX;
            const clientY = e.touches[0].clientY;

            if (!isSwiping) {
                const totalDx = clientX - touchStartX;
                const totalDy = clientY - touchStartY;
                if (Math.hypot(totalDx, totalDy) < SWIPE_DRAG_THRESHOLD) {
                    return; // still within tap tolerance
                }
                isSwiping = true;
                swipeLastX = clientX;
                swipeLastY = clientY;
            }

            e.preventDefault();
            const dx = clientX - swipeLastX;
            const dy = clientY - swipeLastY;
            swipeLastX = clientX;
            swipeLastY = clientY;

            const TOUCH_PAN_SENSITIVITY = 0.003;
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
            resetSwipeTracking();
        } else if (e.touches.length === 1) {
            touchStartX = swipeLastX = e.touches[0].clientX;
            touchStartY = swipeLastY = e.touches[0].clientY;
            isSwiping = false;
        }
    }, { passive: true });

    AppState.container.addEventListener('touchcancel', () => {
        pinchStartDistance  = null;
        pinchStartZoomStage = null;
        resetSwipeTracking();
    }, { passive: true });


    // ============================================================
    // WINDOW RESIZE
    // ============================================================
    window.addEventListener('resize', () => {
        AppState.activeCamera.aspect =
        AppState.container.clientWidth / AppState.container.clientHeight;
        AppState.activeCamera.updateProjectionMatrix();
        AppState.renderer.setSize(
            AppState.container.clientWidth,
            AppState.container.clientHeight
        );
        AppState.renderer.setPixelRatio(getRenderPixelRatio());
        // Keep the post-processing buffers in sync with the drawing buffer.
        if (AppState.composer) AppState.composer.setSize();
    });
}
