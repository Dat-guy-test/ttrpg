// ============================================================
// PERK EFFECTS
//
// Bridges TreeNode/Tree (the skill tree) to characterState.js (the
// character sheet), equipmentState.js (Equipment tab) and spellState.js.
// A tree node may carry an `effects` array; each entry gets a stable
// modifier source id `node:<nodeId>:<index in effects array>` so several
// effects on one node apply and clear independently.
//
// Most effect types are numeric and go through setPerkModifier()/
// clearPerkModifiers(). Exceptions, each routed to its own store:
//   'attribute'        — setAttributeSource()/clearAttributeSource()
//   'currency'         — addCurrency()
//   'item'             — addItemQuantity()
//   'spellUnlock' / 'spellSchoolUnlock' — spellState.js
//   'attributeChoice'  — the player picks attributes from a list
//
// PLAYER CHOICES (attributeChoice / spellSchoolUnlock)
//   collectNodeChoices(node) — async; opens choiceDialog.js and returns
//        { attr: {[effectIndex]: number[]}, spell: {[effectIndex]: id|null} }
//        or null if the player gave up. nodeNeedsChoices(node) says
//        whether a dialog would really open.
//   TreeNode.onClick() collects choices BEFORE activating; null = the
//   perk is never activated. applyNodeEffect(node) WITHOUT picks for a
//   node that needs them (edit mode re-applying an edited active node)
//   opens the dialog from here.
//
// RESTORING A PREVIOUS SESSION (treePersistence.js)
//   applyNodeEffect(node, { restoring: true, savedChoices, savedSpellChoices })
//   skips 'currency'/'item' (already persisted) and never opens a dialog.
//
// PERFORMANCE NOTES (changes vs. the previous version)
//   Every applyNodeEffect()/removeNodeEffect() used to synchronously
//   re-render the Character, Equipment AND Arkana sheets — on a reload
//   with ~40 active perks that was >100 full innerHTML rebuilds before
//   the first frame, for tabs nobody was looking at. Now:
//     - refreshes are COALESCED (one per sheet per task, via microtask),
//       and
//     - a sheet is only re-rendered while its tab is visible; a hidden
//       sheet is just marked dirty and re-rendered the moment its tab is
//       opened (listener on the tab bar, which fires after openTab()).
//   Rendering always reads live state, so what the player sees is the
//   same as before.
// ============================================================

import AppState from './appState.js';
import {
    setPerkModifier,
    clearPerkModifiers,
    setPerksTaken,
    setAttributeSource,
    clearAttributeSource,
    EFFECT_TYPES,
} from './characterState.js';
import { addCurrency, addItemQuantity, getCurrency, getItemQuantity } from './equipmentState.js';
import {
    addKnownSpell, removeKnownSpell,
    addSpellSchoolGrant, removeSpellSchoolGrant, getEligibleSpellsForSchoolGrant,
} from './spellState.js';
import { refreshCharacterSheet } from './characterSheet.js';
import { refreshEquipmentSheet } from './equipmentSheet.js';
import { refreshArcanaSheet } from './arcanaSheet.js';
import {
    saveAttributeChoiceSelection, clearAttributeChoiceSelection,
    saveSpellSchoolChoice, clearSpellSchoolChoice,
} from './treePersistence.js';
import { chooseAttributes, chooseSpells } from './choiceDialog.js';


// ============================================================
// Coalesced, visibility-aware sheet refreshes
// ============================================================

const lazySheets = {
    character: { id: 'characterPage', refresh: refreshCharacterSheet, dirty: false },
    equipment: { id: 'equipmentPage', refresh: refreshEquipmentSheet, dirty: false },
    arcana:    { id: 'arcanaPage',    refresh: refreshArcanaSheet,    dirty: false },
};
let sheetFlushQueued = false;

/** True if the element exists and none of its ancestors is display:none. */
function isShown(id) {
    const el = document.getElementById(id);
    return !!el && el.offsetParent !== null;
}

function flushSheetRefreshes() {
    sheetFlushQueued = false;
    for (const sheet of Object.values(lazySheets)) {
        if (sheet.dirty && isShown(sheet.id)) {
            sheet.dirty = false;
            sheet.refresh();
        }
    }
}

/** Marks sheets dirty and schedules one flush for the end of the current task. */
function requestSheetRefresh(...names) {
    for (const name of names) lazySheets[name].dirty = true;
    if (!sheetFlushQueued) {
        sheetFlushQueued = true;
        queueMicrotask(flushSheetRefreshes);
    }
}

// openTab() (inline onclick in index.html) runs on the button first and then
// this listener runs as the click bubbles up — i.e. after the tab is shown.
const tabBar = document.querySelector('.tab');
if (tabBar) tabBar.addEventListener('click', flushSheetRefreshes);

function refreshSheets() {
    requestSheetRefresh('character', 'equipment', 'arcana');
}


/**
 * A perk that granted currency or items may only be revoked while the
 * player still has at least as much of it as the perk granted.
 * @param {import('./TreeNode.js').TreeNode} node
 * @returns {boolean}
 */
export function canRevokeNodeEffect(node) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return true;

    return node.effects.every(effect => {
        if (!effect || !effect.type) return true;
        const amount = Number(effect.amount) || 0;

        if (effect.type === 'currency') {
            return getCurrency() >= amount;
        }
        if (effect.type === 'item') {
            return getItemQuantity(effect.key) >= amount;
        }
        return true;
    });
}


// ============================================================
// Player choices
// ============================================================

/** Stable key identifying "the same" spell grant, so identical grants share one dialog. */
function spellGrantKey(effect) {
    return `${[...(effect.schools || [])].sort().join(',')}|${Number(effect.maxComplexity) || 0}`;
}

function emptyChoices() {
    return { attr: {}, spell: {} };
}

/** @returns {boolean} true only if collectNodeChoices() would really open a dialog for this node. */
export function nodeNeedsChoices(node) {
    if (!Array.isArray(node.effects)) return false;
    return node.effects.some(effect => {
        if (!effect) return false;
        if (effect.type === 'attributeChoice') {
            return Array.isArray(effect.options) && effect.options.length > 0;
        }
        if (effect.type === 'spellSchoolUnlock') {
            return getEligibleSpellsForSchoolGrant(effect.schools || [], effect.maxComplexity).length > 0;
        }
        return false;
    });
}

/**
 * Opens the pick-from-a-list dialog(s) for this node's 'attributeChoice'
 * and 'spellSchoolUnlock' effects.
 * @returns {Promise<{attr:{[i:number]:number[]}, spell:{[i:number]:string|null}}|null>} null if the player gave up
 */
export async function collectNodeChoices(node) {
    const choices = emptyChoices();
    const effects = Array.isArray(node.effects) ? node.effects : [];

    // ---- Atrybut do Wyboru: one dialog per effect, "select N" ---------
    for (let i = 0; i < effects.length; i++) {
        const effect = effects[i];
        if (!effect || effect.type !== 'attributeChoice') continue;

        const options = Array.isArray(effect.options) ? effect.options : [];
        if (options.length === 0) continue;
        const count = Math.max(1, Math.min(Number(effect.count) || 1, options.length));

        const picked = await chooseAttributes({ nodeName: node.nodeName, options, count });
        if (picked === null) return null;
        choices.attr[i] = picked;
    }

    // ---- Odblokuj Zaklęcia wg Szkoły: identical grants merged ---------
    const groups = new Map(); // grantKey -> effect indexes
    effects.forEach((effect, i) => {
        if (!effect || effect.type !== 'spellSchoolUnlock') return;
        const key = spellGrantKey(effect);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
    });

    const alreadyPicked = new Set();
    for (const indexes of groups.values()) {
        const effect = effects[indexes[0]];
        const eligible = getEligibleSpellsForSchoolGrant(effect.schools || [], effect.maxComplexity)
            .filter(s => !alreadyPicked.has(s.id));
        if (eligible.length === 0) continue;

        const count = Math.min(indexes.length, eligible.length);
        const picked = await chooseSpells({
            nodeName: node.nodeName,
            spells: eligible,
            count,
            schools: effect.schools || [],
            maxComplexity: effect.maxComplexity,
        });
        if (picked === null) return null;

        indexes.forEach((effectIndex, k) => {
            choices.spell[effectIndex] = picked[k] ?? null;
        });
        picked.forEach(id => alreadyPicked.add(id));
    }

    return choices;
}

/** Grants the picked attributes of an 'attributeChoice' effect and remembers/persists the picks. */
function applyAttributeChoiceEffect(node, effect, index, chosen) {
    const options = Array.isArray(effect.options) ? effect.options : [];
    if (options.length === 0) return;

    const chosenIndexes = (Array.isArray(chosen) ? chosen : [])
        .filter(i => Number.isInteger(i) && i >= 0 && i < options.length);

    if (!node._attributeChoiceSelections) node._attributeChoiceSelections = {};
    node._attributeChoiceSelections[index] = chosenIndexes;
    saveAttributeChoiceSelection(node.nodeId, index, chosenIndexes);

    chosenIndexes.forEach(optIdx => {
        const opt = options[optIdx];
        if (!opt) return;
        setAttributeSource(opt.name, `node:${node.nodeId}:${index}:${optIdx}`, opt.description || '', opt.bonuses || []);
    });
}

/** Grants the ONE picked spell of a 'spellSchoolUnlock' effect (only if it's still eligible). */
function applySpellSchoolUnlockEffect(node, effect, index, chosenSpellId) {
    const sourceId = `node:${node.nodeId}:${index}`;
    const eligible = getEligibleSpellsForSchoolGrant(effect.schools || [], effect.maxComplexity);
    const chosenId = (chosenSpellId && eligible.some(s => s.id === chosenSpellId)) ? chosenSpellId : null;

    if (!node._spellSchoolChoiceSelections) node._spellSchoolChoiceSelections = {};
    node._spellSchoolChoiceSelections[index] = chosenId;
    saveSpellSchoolChoice(node.nodeId, index, chosenId);

    addSpellSchoolGrant(sourceId, effect.schools || [], effect.maxComplexity, chosenId);
}


// ============================================================
// Apply / remove
// ============================================================

/**
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{
 *   restoring?: boolean,
 *   savedChoices?: {[effectIndex:string]: number[]},
 *   savedSpellChoices?: {[effectIndex:string]: string|null},
 *   choices?: {attr:{[i:number]:number[]}, spell:{[i:number]:string|null}},
 * }} [opts]
 */
export function applyNodeEffect(node, opts = {}) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;
    const restoring = !!opts.restoring;
    const deferred = !restoring && !opts.choices && nodeNeedsChoices(node);

    const attrPick = (index) => restoring
        ? (opts.savedChoices ? opts.savedChoices[index] : undefined)
        : (opts.choices ? opts.choices.attr[index] : undefined);
    const spellPick = (index) => restoring
        ? (opts.savedSpellChoices ? opts.savedSpellChoices[index] : null)
        : (opts.choices ? opts.choices.spell[index] : null);

    node.effects.forEach((effect, index) => {
        if (!effect || !effect.type) return;

        const effectDef = EFFECT_TYPES.find(e => e.value === effect.type);
        if (!effectDef) {
            console.error(`perkEffects: unknown effect type "${effect.type}" on node "${node.nodeId}" (effect #${index}).`);
            return;
        }
        if (effectDef.needsKey !== false && !effect.key) return; // malformed — missing required target

        const sourceId = `node:${node.nodeId}:${index}`;

        if (effect.type === 'attribute') {
            setAttributeSource(effect.key, sourceId, effect.description || '', effect.bonuses || []);
        } else if (effect.type === 'attributeChoice') {
            if (deferred) return; // applied once the dialog closes — see below
            applyAttributeChoiceEffect(node, effect, index, attrPick(index));
        } else if (effect.type === 'currency') {
            if (!restoring) addCurrency(effect.amount); // NOT idempotent
        } else if (effect.type === 'item') {
            if (!restoring) addItemQuantity(effect.key, effect.amount);
        } else if (effect.type === 'spellUnlock') {
            addKnownSpell(sourceId, effect.key);
        } else if (effect.type === 'spellSchoolUnlock') {
            if (deferred) return;
            applySpellSchoolUnlockEffect(node, effect, index, spellPick(index));
        } else {
            // characteristic, skillExperience, skillImprovisation, proficiency, point-pool grants
            setPerkModifier(
                effectDef.fieldPath(effect.key),
                sourceId,
                effect.amount,
                `${effectDef.label}: ${node.nodeName}`
            );
        }
    });

    refreshSheets();

    if (deferred) {
        collectNodeChoices(node).then((choices) => {
            const picks = choices || emptyChoices(); // gave up: apply with no pick
            node.effects.forEach((effect, index) => {
                if (!effect) return;
                if (effect.type === 'attributeChoice') applyAttributeChoiceEffect(node, effect, index, picks.attr[index]);
                else if (effect.type === 'spellSchoolUnlock') applySpellSchoolUnlockEffect(node, effect, index, picks.spell[index]);
            });
            refreshSheets();
        });
    }
}

/**
 * @param {import('./TreeNode.js').TreeNode} node
 * For a normal deactivation click the caller (TreeNode.onClick) must have
 * already checked canRevokeNodeEffect(). Edit mode bypasses that gate.
 */
export function removeNodeEffect(node) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;

    node.effects.forEach((effect, index) => {
        const sourceId = `node:${node.nodeId}:${index}`;

        if (effect && effect.type === 'currency') {
            addCurrency(-(Number(effect.amount) || 0)); // best-effort refund; may go negative
        } else if (effect && effect.type === 'item') {
            addItemQuantity(effect.key, -(Number(effect.amount) || 0));
        } else if (effect && effect.type === 'spellUnlock') {
            removeKnownSpell(sourceId);
        } else if (effect && effect.type === 'spellSchoolUnlock') {
            removeSpellSchoolGrant(sourceId);
            if (node._spellSchoolChoiceSelections) delete node._spellSchoolChoiceSelections[index];
            clearSpellSchoolChoice(node.nodeId, index);
        } else if (effect && effect.type === 'attributeChoice') {
            const chosenIndexes = (node._attributeChoiceSelections && node._attributeChoiceSelections[index]) || [];
            chosenIndexes.forEach(optIdx => {
                clearAttributeSource(`node:${node.nodeId}:${index}:${optIdx}`);
            });
            if (node._attributeChoiceSelections) delete node._attributeChoiceSelections[index];
            clearAttributeChoiceSelection(node.nodeId, index);
        } else {
            clearPerkModifiers(sourceId);
            clearAttributeSource(sourceId);
        }
    });

    refreshSheets();
}

/**
 * Rebuilds the "Wybrane Perki" list from the CURRENTLY active tree nodes.
 * Call after every activation/deactivation, and once from main.js after
 * restoreActiveNodes().
 */
export function refreshPerksTaken() {
    if (!AppState.tr) return;
    const active = AppState.tr.nodes
    .filter(n => n.nodeActive)
    .map(n => ({ id: n.nodeId, name: n.nodeName, cost: Number(n.nodeCost) || 0 }));
    setPerksTaken(active);
    requestSheetRefresh('character');
}
