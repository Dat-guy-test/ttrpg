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
//   cameraControls ← appState
//   sceneSetup     ← appState, constants, THREE, postprocessing
//   TreeNode       ← appState, constants, THREE, StarModel, cameraControls, editMode
//   Tree           ← appState, THREE, TreeNode, cameraControls
//   inputHandlers  ← appState, cameraControls, editMode
//   editMode       ← appState
//   equipmentState ← items.json (no local module imports)
//   equipmentSheet ← equipmentState
//   main           ← all of the above
// =============================================================

import AppState from './appState.js';
import { initScene } from './sceneSetup.js';
import { initCharacterSheet } from './characterSheet.js';
import { initEquipmentSheet } from './equipmentSheet.js';
import { Tree, treeGen } from './Tree.js';
import {
  panCamera,
  zoomCamera,
  freeCameraMovement,
  freeCameraPositionUpdate,
  computeZoomCamera,
} from './cameraControls.js';
import { registerInputHandlers } from './inputHandlers.js';
import { initEditMode } from './editMode.js';


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
// 4. Attach all DOM event listeners
registerInputHandlers();

// 5. Fetch node data, instantiate TreeNodes, draw arcs,
//    then orient the camera toward the root node (ID 1).
async function sec() {
  await treeGen(AppState.tr);
  AppState.tr.init();

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
//   3. Zoom animation
//   4. Arrow-key momentum rotation (main camera)
//   5. Star shader time uniform updates
//   6. WASD / Space / Shift free-camera translation
//   7. Render through the bloom post-processing pipeline
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

  // --- Main camera arrow-key momentum ---------------------------
  freeCameraMovement();

  // --- Star shader time uniforms --------------------------------
  for (const star of AppState.starClasses) {
    if (star.isModelReady()) {
      star.customUniforms.time.value += delta;
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
