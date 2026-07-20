// ============================================================
// CONSTANTS
// Fixed values shared across the application.
// Import from here rather than hard-coding magic numbers.
// ============================================================

/**
 * Three.js layer index for the SelectiveBloomEffect selection set.
 * Any mesh assigned to this layer will glow; everything else will not.
 */
export const BLOOM_LAYER = 2;

/**
 * Base (zoomStage = 0) vertical field of view, in degrees, used for
 * both the main skill-tree camera and the debug free-fly camera (see
 * sceneSetup.js's initScene()). AppState.zoomStage (0-60) is added on
 * top of this as whole FOV-degree steps — cameraControls.js's
 * computeZoomCamera()/zoomCamera()/updateZoomInertia(),
 * computeInitialZoomStage(), and inputHandlers.js's wheel/keyboard/touch
 * zoom handlers all assume `camera.fov === BASE_CAMERA_FOV + zoomStage`
 * whenever no pan/zoom animation is actively mid-flight.
 */
export const BASE_CAMERA_FOV = 30;

/**
 * Where treeGen() fetches the skill-tree data from.
 *
 * nodes.json lives in `public/nodes.json`. Vite serves everything in
 * `public/` unchanged from the site root, but that root shifts when
 * `base` is set (see vite.config.js — GitHub Pages needs a repo-name
 * prefix in production). import.meta.env.BASE_URL always reflects
 * the CURRENT base ('/' in dev, '/your-repo-name/' in a Pages build),
 * so building the URL from it works correctly in both npm run dev
 * and the deployed site without ever hardcoding a prefix here.
 */
export const NODE_DATA_URL = `${import.meta.env.BASE_URL}nodes.json`;

/**
 * Real font file (.ttf/.otf/.woff) used to render every node's
 * nameText label via troika-three-text (see TreeNode.js). Unlike the
 * old typeface-JSON approach, troika loads this directly at runtime —
 * so it must live in `public/` (served as-is) rather than be
 * imported from `src/`, same reasoning as NODE_DATA_URL above:
 * import.meta.env.BASE_URL keeps the path correct in both
 * `npm run dev` ('/') and a GitHub Pages build ('/repo-name/').
 *
 * Any font with full Unicode/Latin-Extended-A coverage works here —
 * that's what actually fixes the missing Polish diacritics (ą, ę, ł,
 * ó, ż, ź, ć, ś, ń); the old .typeface.json was simply missing those
 * glyphs. Drop your chosen font file at public/fonts/<name>, and
 * update the filename below to match.
 */
export const LABEL_FONT_URL = `${import.meta.env.BASE_URL}fonts/MedievalSharp-Regular.ttf`;

/**
 * Node nameText labels are rescaled every frame based on the current
 * zoom level (see main.js's animate() loop and TreeNode.updateLabelScale()),
 * so they stay legible when zoomed out instead of shrinking into
 * illegibility along with everything else in the perspective view.
 *
 * LABEL_MIN_SCALE is the floor — 1.0 means "never smaller than the
 * label's current baked-in fontSize" (see TreeNode.js's `fontSize: 0.02`),
 * i.e. today's look at full zoom-in.
 * LABEL_MAX_SCALE is the ceiling reached at full zoom-out — tune this
 * upward until labels are comfortably readable zoomed all the way
 * out, then back off until neighbouring labels stop overlapping.
 */
export const LABEL_MIN_SCALE = 1.0;
export const LABEL_MAX_SCALE = 10.0;

/**
 * Starting perk-point budget for the Character Creation stage (see
 * progressionState.js). Hard-coded rather than player-editable so
 * every new character begins from the same baseline.
 */
export const INITIAL_PERK_POINTS = 20;

/**
 * Node id treated as the root of the "Character Creation" branch of
 * the skill tree (nodes.json's "Podróżnik"). Any node whose `requires`
 * chain traces back to this id — directly or transitively — is a
 * candidate for permanent locking when Character Creation ends. See
 * progressionState.js's finishCharacterCreation().
 */
export const CHARACTER_CREATION_ROOT_ID = '1';
