// =============================================================
// MAIN  —  application entry point
//
// Jobs: boot the scene, register input listeners, create the skill
// tree and load its data (sec), and run the per-frame animate loop.
// See the individual modules for details.
//
// LOADING OVERLAY: boot drives loadingProgress.js's weighted bar.
// finishLoading() fires either once every node's StarModel is ready
// (+ one painted frame) or via an 8 s hard-timeout fallback.
//
// PERFORMANCE NOTES (changes vs. the previous version)
//   - The animate loop no longer renders while the skill-tree tab is
//     hidden (Character/Equipment/Arkana/Manual tabs). Before, the
//     bloom pipeline + sky shader kept running at full rate on an
//     invisible canvas. Clocks are still drained while hidden so no
//     huge delta appears on return, and a 'resize' is re-dispatched
//     on return so the renderer matches the (possibly changed) window.
//   - Label scale is only written to ~170 troika Text objects when the
//     zoom-driven scale actually changed (or nodes/groups were added).
//   - Star shader time is advanced once per distinct shared material
//     (see StarModel.js's advanceStarTime()).
// =============================================================

import AppState from './appState.js';
import { initScene } from './sceneSetup.js';
import { initCharacterSheet } from './characterSheet.js';
import { initEquipmentSheet } from './equipmentSheet.js';
import { initArcanaSheet } from './arcanaSheet.js';
import { initManualSheet } from './manualSheet.js';
import { Tree, treeGen } from './Tree.js';
import {
  panCamera,
  updateZoomInertia,
  computeInitialZoomStage,
  freeCameraMovement,
  freeCameraPositionUpdate,
  computeZoomCamera,
  zoomCamera,
} from './cameraControls.js';
import { registerInputHandlers } from './inputHandlers.js';
import { initEditMode } from './editMode.js';
import { LABEL_MIN_SCALE, LABEL_MAX_SCALE, BASE_CAMERA_FOV, MIN_CAMERA_FOV, MAX_CAMERA_FOV } from './constants.js';
import { restoreActiveNodes } from './treePersistence.js';
import { refreshPerksTaken } from './perkEffects.js';
import { initPremadeCharacterPicker } from './premadeCharacters.js';
import { advanceStarTime } from './StarModel.js';
import { applyPerformanceTuning, updatePerformanceTuning } from './performanceTuning.js';
import {
  initLoadingOverlay,
  reportSceneReady,
  reportFetchDone,
  setTotalTextures,
  reportTextureReady,
  reportFirstFrame,
  finishLoading,
} from './loadingProgress.js';

const LOADING_HARD_TIMEOUT_MS = 8000;

// ============================================================
// BOOT SEQUENCE (order matters)
// ============================================================
initLoadingOverlay();

initScene();
applyPerformanceTuning(); // pixel-ratio cap, grass thinning, bloom levels, sky shader patch — see performanceTuning.js
reportSceneReady();

AppState.tr = new Tree(0, 40, 20, 60);

initEditMode();
initCharacterSheet();
initEquipmentSheet();
initArcanaSheet();
initManualSheet();
initPremadeCharacterPicker();
registerInputHandlers();

async function sec() {
  await treeGen(AppState.tr);
  reportFetchDone();
  AppState.tr.init();

  // Bring back every node that was active before the last reload (see
  // treePersistence.js), then rebuild "Wybrane Perki".
  restoreActiveNodes(AppState.tr);
  refreshPerksTaken();

  // ---- Loading overlay: track each node's StarModel readiness -------
  // A StarModel is "ready" once the SHARED base images are loaded, so
  // this now completes almost immediately after the first fetch instead
  // of waiting for 150+ per-node recolour passes.
  const totalNodes = AppState.tr.nodes.length;
  setTotalTextures(totalNodes);
  setTimeout(finishLoading, LOADING_HARD_TIMEOUT_MS);

  let readyCount = 0;
  AppState.tr.nodes.forEach((node) => {
    const starModel = AppState.starClasses[node.starID];
    starModel.onReady(() => {
      reportTextureReady();
      readyCount++;
      if (readyCount === totalNodes) {
        requestAnimationFrame(() => {
          reportFirstFrame();
          finishLoading();
        });
      }
    });
  });

  // ---- Initial zoom level, adapted to the current window size --------
  AppState.zoomStage    = computeInitialZoomStage(AppState.container.clientWidth, AppState.container.clientHeight);
  AppState.iniPanCamFov = BASE_CAMERA_FOV + AppState.zoomStage;

  const vec = AppState.tr.getNodeSphericalCoordinates(1);
  AppState.camera.rotation.set(
    vec.y,
    vec.x + AppState.cameraRotationOffsetFromTree,
    0
  );
  AppState.camera.fov = AppState.iniPanCamFov;
  AppState.camera.updateProjectionMatrix();

  console.log(AppState.tr.nodes);
}
sec();


// ============================================================
// ANIMATE LOOP
// ============================================================

// Label-scale cache — see the notes at the top of this file.
let lastLabelScale = NaN;
let lastLabelNodeCount = -1;
let lastLabelGroupCount = -1;
const LABEL_SCALE_EPSILON = 1e-3;

let wasSceneHidden = false;

/** False while the skill-tree tab (or any ancestor of the canvas) is display:none. */
function isSceneVisible() {
  return AppState.container.offsetParent !== null;
}

function updateLabelScales() {
  if (!AppState.tr) return;

  const zoomT = Math.max(0, Math.min(1,
    (AppState.camera.fov - MIN_CAMERA_FOV) / (MAX_CAMERA_FOV - MIN_CAMERA_FOV)
  )); // 0 = fully zoomed in, 1 = fully zoomed out
  const labelScale = LABEL_MIN_SCALE + (LABEL_MAX_SCALE - LABEL_MIN_SCALE) * zoomT;

  const nodes  = AppState.tr.nodes;
  const groups = AppState.tr.groups;

  const changed =
    !(Math.abs(labelScale - lastLabelScale) <= LABEL_SCALE_EPSILON) ||
    nodes.length  !== lastLabelNodeCount ||
    groups.length !== lastLabelGroupCount;
  if (!changed) return;

  lastLabelScale      = labelScale;
  lastLabelNodeCount  = nodes.length;
  lastLabelGroupCount = groups.length;

  for (const node of nodes) node.updateLabelScale(labelScale);
  for (const group of groups) {
    if (group.labelText) group.labelText.scale.setScalar(labelScale);
  }
}

function animate() {
  AppState.stats.begin();

  const delta = AppState.clock.getDelta();

  // Skill-tree tab hidden: nothing is visible, so do no work — but keep the
  // clocks drained so the first visible frame doesn't see a giant delta.
  if (!isSceneVisible()) {
    AppState.cameraClock.getDelta();
    wasSceneHidden = true;
    requestAnimationFrame(animate);
    AppState.stats.end();
    return;
  }
  if (wasSceneHidden) {
    wasSceneHidden = false;
    // The window may have been resized while the canvas had no size.
    window.dispatchEvent(new Event('resize'));
  }

  // --- Camera animations ----------------------------------------
  if (AppState.panComputeBool) panCamera();

  if (AppState.queuedZoomOut && !AppState.zoomComputeBool && !AppState.panCamBool) {
    AppState.queuedZoomOut = false;
    computeZoomCamera(-AppState.zoomDelta);
  }
  if (AppState.zoomComputeBool) zoomCamera();

  updateZoomInertia(delta);
  freeCameraMovement();

  // --- Star shader time (once per shared material) ----------------
  advanceStarTime(delta);
  updatePerformanceTuning();

  // --- Node + group label scale vs. ACTUAL zoom ------------------
  updateLabelScales();

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
