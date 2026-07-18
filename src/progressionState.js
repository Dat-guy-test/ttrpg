// ============================================================
// PROGRESSION STATE
//
// Tracks which of the three site-wide stages the character is
// currently in, and which tree nodes are permanently locked as a
// result of a past stage transition. Same singleton + localStorage
// pattern as characterState.js / equipmentState.js.
//
// STAGES
//   'creation' — Character Creation. Perk tree freely pick/revoke,
//                using a hard-coded starting budget (constants.js's
//                INITIAL_PERK_POINTS). Equipment sells at full value.
//                Ends via finishCharacterCreation() → 'usage'.
//   'usage'    — Play. Perk tree is entirely frozen (no picking, no
//                revoking). Equipment sells at half value (rounded
//                up) or a GM-approved custom price. Ends via
//                startLevelUp() → 'levelup'.
//   'levelup'  — Leveling up between sessions. New perks may be
//                picked; nodes locked by a PAST stage may NOT be
//                revoked, but nodes picked THIS levelup session still
//                can be, until finishLevelUp() locks them and returns
//                to 'usage'. No equipment selling during this stage.
//
// LOCKING
//   Every node activated during 'creation' (that's a descendant of
//   CHARACTER_CREATION_ROOT_ID) or during a 'levelup' session is
//   locked the moment that session ends — see isNodeLocked() /
//   findLockableDescendants().
//
// This module only imports constants.js, so Tree.js / TreeNode.js /
// characterSheet.js can all import it without creating a cycle.
// ============================================================

import { CHARACTER_CREATION_ROOT_ID } from './constants.js';

const STORAGE_KEY = 'ttrpgProgression.v1';

export const STAGES = {
    CREATION: 'creation',
    USAGE:    'usage',
    LEVELUP:  'levelup',
};

const STAGE_LABELS = {
    [STAGES.CREATION]: 'Tworzenie Postaci',
    [STAGES.USAGE]:    'Użytkowanie',
    [STAGES.LEVELUP]:  'Rozwój Postaci (Level Up)',
};

const STAGE_BUTTON_LABELS = {
    [STAGES.CREATION]: 'Zakończ Tworzenie Postaci',
    [STAGES.USAGE]:    'Zrealizuj potencjał',
    [STAGES.LEVELUP]:  'Zakończ wybór atrybutów',
};

function buildDefaultState() {
    return {
        stage: STAGES.CREATION,
        lockedNodeIds: [], // string[] — node ids that can never be revoked again
    };
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildDefaultState();
        const saved = JSON.parse(raw);
        const out = buildDefaultState();
        if (Object.values(STAGES).includes(saved.stage)) out.stage = saved.stage;
        if (Array.isArray(saved.lockedNodeIds)) out.lockedNodeIds = saved.lockedNodeIds.map(String);
        return out;
    } catch (e) {
        console.error('ProgressionState: failed to load — starting fresh.', e);
        return buildDefaultState();
    }
}

export const ProgressionState = load();

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ProgressionState));
    } catch (e) {
        console.error('ProgressionState: failed to save.', e);
    }
}

export function getStage() {
    return ProgressionState.stage;
}

export function getStageDisplayName() {
    return STAGE_LABELS[ProgressionState.stage] || ProgressionState.stage;
}

export function getStageButtonLabel() {
    return STAGE_BUTTON_LABELS[ProgressionState.stage] || '';
}

export function isNodeLocked(nodeId) {
    return ProgressionState.lockedNodeIds.includes(String(nodeId));
}

/** True while the tree allows picking NEW perks (creation or levelup). */
export function canPickPerks() {
    return ProgressionState.stage === STAGES.CREATION || ProgressionState.stage === STAGES.LEVELUP;
}

/**
 * True if this specific, currently-ACTIVE node may be revoked right
 * now — false during 'usage' (nothing may be revoked at all), and
 * false for any node already locked by a past stage transition
 * (regardless of the current stage).
 */
export function canRevokePerk(nodeId) {
    if (ProgressionState.stage === STAGES.USAGE) return false;
    return !isNodeLocked(nodeId);
}

/**
 * 'full'       — Character Creation: sell at the same price as buying.
 * 'restricted' — Usage: sell at half value (rounded up) or a custom
 *                GM-approved price.
 * null         — Level Up: selling is disabled entirely.
 */
export function getSellMode() {
    if (ProgressionState.stage === STAGES.CREATION) return 'full';
    if (ProgressionState.stage === STAGES.USAGE) return 'restricted';
    return null;
}

/**
 * True once the Character Creation root node itself (constants.js's
 * CHARACTER_CREATION_ROOT_ID — "Podróżnik") is active. Character
 * Creation cannot end until this is true, since the whole "lock
 * everything above this node's theta" rule (see
 * findLockableByTheta() below) only makes sense once the root has
 * actually been picked.
 * @param {import('./Tree.js').Tree} tree
 * @returns {boolean}
 */
export function isRootNodeActive(tree) {
    const root = tree.resolveNode(CHARACTER_CREATION_ROOT_ID);
    return !!root && root.nodeActive;
}

/**
 * Returns the ids of every currently-ACTIVE, not-yet-locked node
 * whose `theta` is lower than the Character Creation root node's
 * `theta`. This replaces the earlier "requires the root, directly or
 * transitively" rule — locking is now purely positional (theta acts
 * as the tree's "depth" axis), regardless of how a node's
 * requirements are actually wired up. The root node's own theta is
 * the cutoff, and the root itself is never locked by this rule
 * (its theta is not lower than itself).
 * @param {import('./Tree.js').Tree} tree
 * @returns {string[]}
 */
function findLockableByTheta(tree) {
    const root = tree.resolveNode(CHARACTER_CREATION_ROOT_ID);
    if (!root) return [];
    const rootTheta = root.theta;

    return tree.nodes
    .filter(n => n.nodeActive && !isNodeLocked(n.nodeId) && n.theta < rootTheta)
    .map(n => String(n.nodeId));
}

/**
 * "Zakończ Tworzenie Postaci" — locks every active perk whose theta
 * is lower than the root node's, then moves to 'usage'. Refuses
 * (returning false, changing nothing) unless the root node itself is
 * currently active — see isRootNodeActive().
 */
export function finishCharacterCreation(tree) {
    if (ProgressionState.stage !== STAGES.CREATION) return false;
    if (!isRootNodeActive(tree)) return false;
    lockNodeIds(findLockableByTheta(tree));
    ProgressionState.stage = STAGES.USAGE;
    save();
    return true;
}

function lockNodeIds(ids) {
    const set = new Set(ProgressionState.lockedNodeIds);
    for (const id of ids) set.add(String(id));
    ProgressionState.lockedNodeIds = [...set];
    save();
}

/** "Zrealizuj potencjał" — moves 'usage' → 'levelup'. */
export function startLevelUp() {
    if (ProgressionState.stage !== STAGES.USAGE) return false;
    ProgressionState.stage = STAGES.LEVELUP;
    save();
    return true;
}

/** "Zakończ wybór atrybutów" — locks every node activated this levelup session, then returns to 'usage'. */
export function finishLevelUp(tree) {
    if (ProgressionState.stage !== STAGES.LEVELUP) return false;
    const newlyActive = tree.nodes
    .filter(n => n.nodeActive && !isNodeLocked(n.nodeId))
    .map(n => String(n.nodeId));
    lockNodeIds(newlyActive);
    ProgressionState.stage = STAGES.USAGE;
    save();
    return true;
}

/**
 * Advances the stage machine per whichever transition the current
 * stage allows. Returns true if a transition happened.
 * @param {import('./Tree.js').Tree} tree
 */
export function advanceStage(tree) {
    if (ProgressionState.stage === STAGES.CREATION) return finishCharacterCreation(tree);
    if (ProgressionState.stage === STAGES.USAGE)    return startLevelUp();
    if (ProgressionState.stage === STAGES.LEVELUP)  return finishLevelUp(tree);
    return false;
}

export function resetProgressionState() {
    Object.assign(ProgressionState, buildDefaultState());
    save();
}
