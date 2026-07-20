// ============================================================
// TREE PERSISTENCE
//
// Root-cause fix for "perks taken / proficiencies / attributes don't
// survive a reload while equipment and progression stage do":
// NOTHING was ever saving which TreeNode instances were active.
// CharacterState.perksTaken / .proficiencies / .attributes are all
// deliberately DERIVED LIVE from active tree nodes (see
// characterState.js's mergeWithDefaults() comment) — so once the
// active-node list is persisted and restored here, those all become
// consistent again automatically, with zero changes needed to
// characterState.js itself.
//
// Storage shape:
//   {
//     activeNodeIds: string[],
//     // Player-picked options for every currently-active
//     // 'attributeChoice' effect, so restoreActiveNodes() never has
//     // to re-prompt the player on every page load:
//     attributeChoiceSelections: { [nodeId]: { [effectIndex]: number[] } },
//   }
//
// Exports:
//   markNodeActive(nodeId) / markNodeInactive(nodeId)
//     — called from TreeNode.js's onClick() whenever a node's
//       nodeActive flips.
//   saveAttributeChoiceSelection(nodeId, effectIndex, indexes) /
//   clearAttributeChoiceSelection(nodeId, effectIndex)
//     — called from perkEffects.js whenever an 'attributeChoice'
//       effect is granted/revoked.
//   restoreActiveNodes(tree)
//     — called once from main.js's sec(), AFTER AppState.tr.init().
//       Re-activates every previously-active node silently (no
//       requirement re-checks, no prompts) via TreeNode.restoreActive().
//   resetTreeState()
//     — called by resetAll.js's resetEverything().
// ============================================================

const STORAGE_KEY = 'ttrpgTreeState.v1';

function buildDefaultState() {
    return {
        activeNodeIds: [],
        attributeChoiceSelections: {},
    };
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildDefaultState();
        const parsed = JSON.parse(raw);
        const out = buildDefaultState();
        if (Array.isArray(parsed.activeNodeIds)) {
            out.activeNodeIds = parsed.activeNodeIds.map(String);
        }
        if (parsed.attributeChoiceSelections && typeof parsed.attributeChoiceSelections === 'object') {
            out.attributeChoiceSelections = parsed.attributeChoiceSelections;
        }
        return out;
    } catch (e) {
        console.error('TreePersistence: failed to load — starting fresh.', e);
        return buildDefaultState();
    }
}

export const TreeState = load();

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(TreeState));
    } catch (e) {
        console.error('TreePersistence: failed to save.', e);
    }
}

/** Records that this node is now active. Safe to call repeatedly. */
export function markNodeActive(nodeId) {
    const id = String(nodeId);
    if (!TreeState.activeNodeIds.includes(id)) TreeState.activeNodeIds.push(id);
    save();
}

/** Records that this node is no longer active, and drops any attributeChoice selections it had staged. */
export function markNodeInactive(nodeId) {
    const id = String(nodeId);
    TreeState.activeNodeIds = TreeState.activeNodeIds.filter(x => x !== id);
    delete TreeState.attributeChoiceSelections[id];
    save();
}

/** @returns {string[]} a copy of every currently-recorded active node id. */
export function getActiveNodeIds() {
    return [...TreeState.activeNodeIds];
}

/** Persists one 'attributeChoice' effect's chosen option indexes for a node, keyed by that effect's index in node.effects. */
export function saveAttributeChoiceSelection(nodeId, effectIndex, indexes) {
    const id = String(nodeId);
    if (!TreeState.attributeChoiceSelections[id]) TreeState.attributeChoiceSelections[id] = {};
    TreeState.attributeChoiceSelections[id][effectIndex] = [...indexes];
    save();
}

/** Removes one specific 'attributeChoice' effect's persisted selection. */
export function clearAttributeChoiceSelection(nodeId, effectIndex) {
    const id = String(nodeId);
    const forNode = TreeState.attributeChoiceSelections[id];
    if (!forNode) return;
    delete forNode[effectIndex];
    if (Object.keys(forNode).length === 0) delete TreeState.attributeChoiceSelections[id];
    save();
}

/** @returns {{[effectIndex:string]: number[]}|null} this node's persisted attributeChoice selections, or null if it has none. */
export function getSavedChoicesForNode(nodeId) {
    return TreeState.attributeChoiceSelections[String(nodeId)] || null;
}

/**
 * Finds a TreeNode by id directly in tree.nodes, trying both a
 * strict match and a loosely-coerced ("==") match — the raw ids
 * coming out of nodes.json are a mix of shapes ("1", "-1001",
 * "100002", ...) and this file always normalizes what IT stores to
 * strings (see markNodeActive() etc.), so this guards against a
 * TreeNode ending up with its nodeId typed slightly differently than
 * what's persisted. Deliberately does NOT go through a tree-provided
 * lookup method (e.g. a hypothetical resolveNode()) — tree.nodes
 * itself is the one array every other module in this codebase already
 * relies on directly (main.js, TreeNode.js, editMode.js), so it's the
 * one lookup surface guaranteed to behave the way this file expects.
 * @param {import('./Tree.js').Tree} tree
 * @param {string} id
 */
function findNodeById(tree, id) {
    if (!tree || !Array.isArray(tree.nodes)) return null;
    return tree.nodes.find(n => n.nodeId === id)
    || tree.nodes.find(n => String(n.nodeId) === id)
    || tree.nodes.find(n => n.nodeId == id) // eslint-disable-line eqeqeq
    || null;
}

/**
 * Re-activates every node that was active last session. Must run
 * AFTER AppState.tr.init() (so nodes/arcs exist) and BEFORE anything
 * reads "Wybrane Perki"/Charakterystyki/Wprawa/Atrybuty (see main.js's
 * sec(), which calls this then perkEffects.js's refreshPerksTaken()).
 *
 * Each node is restored via TreeNode.restoreActive() — NOT the normal
 * click/activation path — so it skips requirement/cost/mutual-
 * exclusion checks (already valid when originally picked) and never
 * re-prompts for an 'attributeChoice' effect (uses the saved
 * selection instead). Currency/item grants are intentionally SKIPPED
 * during this restore (see perkEffects.js's applyNodeEffect 'restoring'
 * flag) because equipmentState.js's currency/inventory are already
 * fully persisted on their own — reapplying those grants on every
 * reload would double them.
 *
 * Any id in storage that no longer resolves to a real node (e.g. it
 * was deleted from nodes.json) is dropped from the saved list rather
 * than kept around forever. Logs a warning (not an error — a stale id
 * is an expected, harmless case) whenever that happens, so a silent
 * restore failure is visible in the console instead of just looking
 * like "the perks never came back".
 *
 * @param {import('./Tree.js').Tree} tree
 */
export function restoreActiveNodes(tree) {
    if (!tree || !Array.isArray(tree.nodes)) {
        console.warn('treePersistence: restoreActiveNodes() called before the tree was ready — nothing restored.');
        return;
    }

    const ids = getActiveNodeIds();
    const stillValid = [];

    for (const id of ids) {
        const node = findNodeById(tree, id);
        if (!node) {
            console.warn(`treePersistence: previously-active node "${id}" no longer exists in the tree — dropping it from saved progress.`);
            continue;
        }
        stillValid.push(id);
        if (!node.nodeActive) {
            node.restoreActive(getSavedChoicesForNode(id));
        }
    }

    if (stillValid.length !== ids.length) {
        TreeState.activeNodeIds = stillValid;
        save();
    }
}

/** Wipes all tree-progress persistence back to "nothing picked". Used by resetAll.js's resetEverything(). */
export function resetTreeState() {
    Object.assign(TreeState, buildDefaultState());
    save();
}
