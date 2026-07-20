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
// Module dependency graph (no cycles):
//
//   appState       ← (no local imports)
//   constants      ← (no local imports)
//   colorScience   ← (no local imports)
//   StarModel      ← THREE, colorScience
//   cameraControls ← appState, constants
//   sceneSetup     ← appState, constants, THREE, postprocessing
//   treePersistence ← (no local imports)
//   TreeNode       ← appState, constants, THREE, StarModel, cameraControls, editMode, perkEffects, treePersistence
//   Tree           ← appState, THREE, TreeNode, cameraControls
//   inputHandlers  ← appState, cameraControls, editMode, constants
//   editMode       ← appState
//   equipmentState ← items.json (no local module imports)
//   equipmentSheet ← equipmentState
//   main           ← all of the above
// ============================================================

import AppState from './appState.js';
import { initScene } from './sceneSetup.js';
import { initCharacterSheet } from './characterSheet.js';
import { initEquipmentSheet } from './equipmentSheet.js';
import { initArcanaSheet } from './arcanaSheet.js';
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
import { LABEL_MIN_SCALE, LABEL_MAX_SCALE, BASE_CAMERA_FOV } from './constants.js';
import { restoreActiveNodes } from './treePersistence.js';
import { refreshPerksTaken } from './perkEffects.js';


// ============================================================
// BOOT SEQUENCE
// Order matters: scene must exist before Tree (which adds
// meshes to AppState.scene), and input handlers need the tree
// reference in AppState.tr for the Escape debug key.
// ============================================================

// 1. Create renderer, cameras, lights, skybox, ground, telescope
initScene();

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
// 4. Attach all DOM event listeners
registerInputHandlers();

// 5. Fetch node data, instantiate TreeNodes, draw arcs, restore
//    whichever perks were active in a previous session, then orient
//    the camera toward the root node (ID 1).
async function sec() {
  await treeGen(AppState.tr);
  AppState.tr.init();

  // Bring back every node that was active before the last reload —
  // see treePersistence.js's header comment for why this (rather than
  // characterState.js's own storage) is what makes perks taken,
  // Charakterystyki/Umiejętności modifiers, Wprawa, and Atrybuty
  // survive a reload. Must run after tr.init() (so nodes/arcs exist)
  // and before anything reads "Wybrane Perki" or the character sheet.
  restoreActiveNodes(AppState.tr);
  refreshPerksTaken();

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

  // --- Node label scale vs. zoom level ---------------------------
  // AppState.zoomStage ranges 0 (fully zoomed in) .. 60 (fully zoomed
  // out) — see inputHandlers.js's '='/'-'/wheel/pinch handlers. Labels
  // are kept at LABEL_MIN_SCALE (today's size) at full zoom-in and grow
  // toward LABEL_MAX_SCALE as the camera zooms out, so they stay
  // legible instead of shrinking away with everything else in the
  // perspective view. Cheap: TreeNode.updateLabelScale() only touches
  // Object3D.scale, no text re-layout.
  if (AppState.tr) {
    const zoomT = AppState.zoomStage / 60; // 0 = zoomed in, 1 = zoomed out
    const labelScale = LABEL_MIN_SCALE + (LABEL_MAX_SCALE - LABEL_MIN_SCALE) * zoomT;
    for (const node of AppState.tr.nodes) {
      node.updateLabelScale(labelScale);
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
