// =============================================================
// MAIN  —  application entry point
//
// This file's only jobs are:
//   1. Boot the scene (initScene)
//   2. Register all input listeners (registerInputHandlers)
//   3. Create the skill tree and load its data (sec)
//   4. Run the per-frame animate loop
//
// All logic lives in the imported modules.  Refer to those files
// for detailed comments.
//
// LOADING OVERLAY
// ------------------------------------------------------------
// Boot also drives loadingProgress.js's weighted progress bar (see
// that file's header comment for the stage weights) so the splash
// screen in index.html (#loadingOverlay) hides the parchment/3D
// scene assembling underneath it and gives the player a sense of
// how far along loading is, rather than a blank/frozen page.
//
// finishLoading() is called two ways, whichever comes first:
//   - normally, once every node's StarModel has reported ready
//     (see the texture-tracking block in sec() below), followed by
//     the first animate() frame actually painting; or
//   - via a hard 8-second setTimeout fallback set right after
//     setTotalTextures(), in case a StarModel's texture load ever
//     rejects (see StarModel.js's loadTextures().catch()) — that
//     node's onReady() callback would otherwise never fire, and the
//     "wait for every texture" count would never complete, hanging
//     the splash screen forever over a single bad node.
// finishLoading() itself guards against running twice, so whichever
// of these fires first simply wins.
//
// Module dependency graph (no cycles):
//
//   appState        ← (no local imports)
//   constants       ← (no local imports)
//   colorScience    ← (no local imports)
//   loadingProgress ← (no local imports)
//   StarModel       ← THREE, colorScience
//   cameraControls  ← appState, constants
//   sceneSetup      ← appState, constants, THREE, postprocessing
//   treePersistence ← (no local imports)
//   TreeNode        ← appState, constants, THREE, StarModel, cameraControls, editMode, perkEffects, treePersistence
//   Tree            ← appState, THREE, TreeNode, cameraControls, loadingProgress
//   inputHandlers   ← appState, cameraControls, editMode, constants
//   editMode        ← appState
//   equipmentState  ← items.json (no local module imports)
//   equipmentSheet  ← equipmentState
//   manualState     ← manual.json (no local module imports)
//   manualSheet     ← manualState, manualEditor
//   main            ← all of the above
// ============================================================

import AppState from './appState.js';
import { initScene } from './sceneSetup.js';
import { initCharacterSheet } from './characterSheet.js';
import { initEquipmentSheet } from './equipmentSheet.js';
import { initArcanaSheet } from './arcanaSheet.js';
import { initManualSheet } from './manualSheet.js';
import { Tree, treeGen } from './Tree.js';
import {
  panCamera,
  zoomCamera,
  updateZoomInertia,
  computeInitialZoomStage,
  freeCameraMovement,
  freeCameraPositionUpdate,
  computeZoomCamera,
} from './cameraControls.js';
import { registerInputHandlers } from './inputHandlers.js';
import { initEditMode } from './editMode.js';
import { LABEL_MIN_SCALE, LABEL_MAX_SCALE, BASE_CAMERA_FOV, MIN_CAMERA_FOV, MAX_CAMERA_FOV } from './constants.js';
import { restoreActiveNodes } from './treePersistence.js';
import { refreshPerksTaken } from './perkEffects.js';
import { initPremadeCharacterPicker } from './premadeCharacters.js';
import {
  initLoadingOverlay,
  reportSceneReady,
  reportFetchDone,
  setTotalTextures,
  reportTextureReady,
  reportFirstFrame,
  finishLoading,
} from './loadingProgress.js';

// How long to wait, at most, for every node's texture to report ready
// before giving up and revealing the tree anyway — see this file's
// header comment for why a single failed texture load could otherwise
// hang the splash screen forever.
const LOADING_HARD_TIMEOUT_MS = 8000;

// ============================================================
// BOOT SEQUENCE
// Order matters: scene must exist before Tree (which adds
// meshes to AppState.scene), and input handlers need the tree
// reference in AppState.tr for the Escape debug key.
// ============================================================

// 0. Show the splash screen and start tracking boot progress against it.
initLoadingOverlay();

// 1. Create renderer, cameras, lights, skybox, ground, telescope
initScene();
reportSceneReady();

// 2. Create the skill tree container (adds the debug sphere to the scene)
AppState.tr = new Tree(0, 40, 20, 60);

// 3. Build the (hidden) edit-mode inspector panel
initEditMode();
// 3b. Build the character sheet module
initCharacterSheet();
// 3c. Build the equipment sheet module
initEquipmentSheet();
// 3d. Build the Arkana (spells) sheet module
initArcanaSheet();
// 3e. Build the Instrukcja Obsługi (manual) module
initManualSheet();
initPremadeCharacterPicker();
// 4. Attach all DOM event listeners
registerInputHandlers();

// 5. Fetch node data, instantiate TreeNodes, draw arcs, restore
//    whichever perks were active in a previous session, then orient
//    the camera toward the root node (ID 1).
async function sec() {
  await treeGen(AppState.tr);
  reportFetchDone();
  AppState.tr.init();

  // Bring back every node that was active before the last reload —
  // see treePersistence.js's header comment for why this (rather than
  // characterState.js's own storage) is what makes perks taken,
  // Charakterystyki/Umiejętności modifiers, Wprawa, and Atrybuty
  // survive a reload. Must run after tr.init() (so nodes/arcs exist)
  // and before anything reads "Wybrane Perki" or the character sheet.
  restoreActiveNodes(AppState.tr);
  refreshPerksTaken();

  // ---- Loading overlay: track each node's StarModel texture load --
  // Every TreeNode already owns a StarModel with an onReady() hook
  // (see StarModel.js) — this is the dominant cost of booting a tree
  // with 150+ nodes (two texture fetches + a synchronous canvas
  // recolor pass each), so it gets the lion's share of the progress
  // bar's weight (see loadingProgress.js's WEIGHTS.textures).
  const totalNodes = AppState.tr.nodes.length;
  setTotalTextures(totalNodes);

  // Hard-timeout fallback: if any single StarModel's texture load
  // rejects, its onReady() never fires, so the "every texture ready"
  // count below would never complete on its own. This guarantees the
  // splash screen is revealed anyway after LOADING_HARD_TIMEOUT_MS,
  // rather than hanging forever over one bad node. finishLoading()
  // itself no-ops on a second call, so this simply loses the race
  // harmlessly on a normal, healthy load.
  setTimeout(finishLoading, LOADING_HARD_TIMEOUT_MS);

  let readyCount = 0;
  AppState.tr.nodes.forEach((node) => {
    const starModel = AppState.starClasses[node.starID];
    starModel.onReady(() => {
      reportTextureReady();
      readyCount++;
      if (readyCount === totalNodes) {
        // Wait one extra frame after the last texture actually swaps
        // in before revealing the scene, so the very first thing the
        // player sees isn't a flash of not-yet-textured nodes.
        requestAnimationFrame(() => {
          reportFirstFrame();
          finishLoading();
        });
      }
    });
  });

  // ---- Initial zoom level, adapted to the current window size --------
  // A narrow viewport (typically mobile, where #canvas ends up tall and
  // thin — see style.css) squeezes the camera's effective HORIZONTAL
  // field of view well below its vertical one, which can clip a node's
  // label outside the visible frustum even though the node itself is
  // on-screen. computeInitialZoomStage() starts the camera more zoomed
  // out in that case so a full node (sphere + label) stays visible —
  // see cameraControls.js for the underlying reasoning. This also
  // becomes the pan animation's "restore to" FOV (AppState.iniPanCamFov),
  // so it sticks after the very first pan too, not just at boot.
  AppState.zoomStage    = computeInitialZoomStage(AppState.container.clientWidth, AppState.container.clientHeight);
  AppState.iniPanCamFov = BASE_CAMERA_FOV + AppState.zoomStage;

  const vec = AppState.tr.getNodeSphericalCoordinates(1);
  AppState.camera.rotation.set(
    vec.y,
    vec.x + AppState.cameraRotationOffsetFromTree,
    0
  );
  // Restore the camera FOV to its pre-pan default after initial positioning
  AppState.camera.fov = AppState.iniPanCamFov;
  AppState.camera.updateProjectionMatrix();

  // Expose nodes array in the browser console for debugging
  console.log(AppState.tr.nodes);
}
sec();


// ============================================================
// ANIMATE LOOP
// Runs every frame via requestAnimationFrame.
//
// Per-frame order:
//   1. Pan animation
//   2. Queued zoom-out (fired if a zoom-out was requested while
//      another animation was running)
//   3. Zoom-in animation (immediate/snappy step)
//   4. Zoom-out inertia (momentum from the wheel / '-' key / pinch)
//   5. Arrow-key / touch-swipe momentum rotation (main camera)
//   6. Star shader time uniform updates
//   7. Node nameText label rescaling vs. current zoom level
//   8. WASD / Space / Shift free-camera translation
//   9. Render through the bloom post-processing pipeline
// ============================================================
function animate() {
  AppState.stats.begin();

  const delta = AppState.clock.getDelta();

  // --- Camera animations ----------------------------------------
  if (AppState.panComputeBool) panCamera();

  if (AppState.queuedZoomOut && !AppState.zoomComputeBool && !AppState.panCamBool) {
    AppState.queuedZoomOut = false;
    computeZoomCamera(-AppState.zoomDelta);
  }
  if (AppState.zoomComputeBool) zoomCamera();

  // --- Zoom-out momentum (mouse wheel / '-' key — see inputHandlers.js) --
  updateZoomInertia(delta);

  // --- Main camera arrow-key / touch-swipe momentum ---------------
  freeCameraMovement();

  // --- Star shader time uniforms --------------------------------
  for (const star of AppState.starClasses) {
    if (star.isModelReady()) {
      star.customUniforms.time.value += delta;
    }
  }

    // --- Node + group label scale vs. ACTUAL zoom ------------------
  // Driven by camera.fov rather than AppState.zoomStage: zoomStage is only
  // updated when a pan finishes, while panCamera() eases camera.fov every
  // frame, so using zoomStage made labels lag behind (then snap) during pans.
  if (AppState.tr) {
    const zoomT = Math.max(0, Math.min(1,
      (AppState.camera.fov - MIN_CAMERA_FOV) / (MAX_CAMERA_FOV - MIN_CAMERA_FOV)
    )); // 0 = fully zoomed in, 1 = fully zoomed out
    const labelScale = LABEL_MIN_SCALE + (LABEL_MAX_SCALE - LABEL_MIN_SCALE) * zoomT;

    for (const node of AppState.tr.nodes) node.updateLabelScale(labelScale);
    for (const group of AppState.tr.groups) {
      if (group.labelText) group.labelText.scale.setScalar(labelScale);
    }
  }
  // --- Free camera WASD translation -----------------------------
  freeCameraPositionUpdate();

  // --- Render ---------------------------------------------------
  requestAnimationFrame(animate);
  AppState.composer.render();

  AppState.stats.end();
}
animate();

// ============================================================
// REFERENCES
// Lava / fireball shader:  https://stemkoski.github.io/Three.js/Shader-Fireball.html
// Great-circle arc:        https://stackoverflow.com/questions/42663182
// Post-processing:         https://github.com/pmndrs/postprocessing
// CIE colour rendering:    https://www.fourmilab.ch/documents/specrend/
// ============================================================