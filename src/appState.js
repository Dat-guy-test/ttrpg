// ============================================================
// APP STATE  (singleton)
//
// All mutable state that is read or written by more than one
// module lives here as properties on a single plain object.
//
// Why a plain object instead of separate exports?
// ES module bindings are live but read-only from the outside —
// you cannot do `import { panCamBool } from '…'` and then
// `panCamBool = true` in another file; that throws a TypeError.
// Mutating *properties* of an imported object is always allowed,
// so every module just does:
//
//   import AppState from './appState.js';
//   AppState.panCamBool = true;   // ✓ property write — fine
//
// Initialisation order:
//   1. appState.js is evaluated (all fields set to their
//      "before boot" defaults).
//   2. initScene() in sceneSetup.js fills in the Three.js
//      objects (scene, camera, renderer, …).
//   3. main.js creates AppState.tr = new Tree(…).
//   4. sec() / treeGen() populates AppState.tr.nodes.
//   5. animate() loop runs.
// ============================================================

const AppState = {

    // ---- DOM --------------------------------------------------------
    container:   null,   // document.getElementById('canvas'); set in initScene()

    // ---- Three.js core ---------------------------------------------
    scene:        null,
    camera:       null,
    freeCamera:   null,
    activeCamera: null,
    renderer:     null,
    raycaster:    null,
    mouse:        null,  // THREE.Vector2; set in initScene()

    // ---- Post-processing -------------------------------------------
    composer:    null,
    rendek:      null,   // RenderPass
    bloomEffect: null,   // SelectiveBloomEffect
    effectPass:  null,   // EffectPass

    // ---- Timing ----------------------------------------------------
    clock:       null,   // general per-frame delta (shader time, star animation)
    cameraClock: null,   // delta for freeCameraMovement
    panclock:    null,   // elapsed time for pan animations
    zoomclock:   null,   // elapsed time for zoom animations
    animclock:   null,   // reserved for future hover animations

    // ---- Dev overlay -----------------------------------------------
    stats:     null,
    statsShown: false,

    // ---- Font (parsed once in initScene) ---------------------------
    hellishFont: null,

    // ---- Tree ------------------------------------------------------
    tr:                          null,  // Tree instance; assigned in main.js after initScene()
    cameraRotationOffsetFromTree: 0,    // set to -π/2 after treeGen() loads data

    // ---- Game state ------------------------------------------------
    // perkPoints was removed — the perk-point budget now lives entirely
    // in characterState.js (CharacterState.potential.total / spent /
    // computePotentialAvailable()), so it can be edited via the
    // "Potencjał" field on the Character Data tab. See TreeNode.js's
    // onClick() for where activation/deactivation checks it.
    starClasses: [],    // StarModel instances, one per TreeNode; updated by animate()

    // ---- Edit mode (skill-tree editor) -------------------------------
    // editMode:     toggled by the 'E' key (see inputHandlers.js); when true,
    //              clicking a node opens the inspector instead of running
    //              perk activation/deactivation.
    // editSubMode: 'select' (inspect/edit), 'addNode' (click the debug
    //              sphere to place a node), or 'connect' (click a
    //              dependent node then its prerequisite to link them).
    // selectedNode: the TreeNode currently shown in the inspector panel.
    // connectSourceNode: the "dependent" node clicked first in connect
    //              submode, awaiting a second click on its prerequisite.
    // pendingNewNodePos: {fiDeg, thetaDeg} captured by a treesphere click
    //              in addNode submode, while the "create node" form is open.
    // nextCustomNodeId: auto-generated id counter for new nodes that don't
    //              specify their own id; starts well above the sample
    //              data's ids so it can't collide with them.
    editMode:          false,
    editSubMode:       'select',
    selectedNode:      null,
    connectSourceNode: null,
    pendingNewNodePos: null,
    nextCustomNodeId:  100000,

    // ---- Raycasting / hover ----------------------------------------
    intersects: [],
    hovered:    {},

    // ---- Zoom animation state --------------------------------------
    zoomStage:       0,      // discrete zoom level (0 = default FOV)
    zoomDelta:       0,      // FOV change for the current step
    initialZoom:     0,      // FOV at animation start
    finalZoom:       0,      // target FOV at animation end
    zoomCamBool:     false,  // true while zoom animation is running
    zoomComputeBool: false,  // true while per-frame zoom interpolation executes
    zoomCamFov:      0,      // working FOV value mutated each frame
    queuedZoomOut:   false,  // zoom-out was requested mid-animation; fire next frame

    // ---- Pan animation state ---------------------------------------
    panCamBool:     false,  // true while pan animation is running
    panComputeBool: false,  // true while per-frame pan interpolation executes
    panX:           0,      // camera.rotation.x at animation start
    panY:           0,      // camera.rotation.y at animation start
    dPanX:          0,      // total Δx to apply over the animation
    dPanY:          0,      // total Δy to apply over the animation
    iniPanCamFov:   1,      // FOV before pan; restored afterwards
    panCamFov:      0,      // working FOV mutated during pan (subtle dolly effect)

    // ---- Free-camera momentum (arrow keys) -------------------------
    cameraAccelerationX: 0,
    cameraAccelerationY: 0,

    // ---- Input state -----------------------------------------------
    keys: {
        ArrowUp:    false,
        ArrowDown:  false,
        ArrowLeft:  false,
        ArrowRight: false,
    },
    isMouseDown:       false,
    lastMousePosition: { x: 0, y: 0 },
};

export default AppState;

