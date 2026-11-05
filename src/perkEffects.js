// ============================================================
// PERK EFFECTS
//
// Bridges TreeNode/Tree (the skill tree) to characterState.js (the
// character sheet) and equipmentState.js (the Equipment tab). A tree
// node may carry an `effects` array — one node can grant any number
// of independent stat bumps:
//
//   effects: [
//     { type: 'characteristic',    key: 'forma',    amount: 1 },
//     { type: 'skillExperience',   key: 'sila',      amount: 5 },
//     { type: 'skillImprovisation', key: 'sila',      amount: 1 },
//     { type: 'attribute', key: 'Żądza Krwi', description: '...' },
//     { type: 'currency', amount: 5 },
//     { type: 'item', key: 'zestaw-skromny', amount: 1 },
//   ]
//
// Each entry gets its own stable modifier source id —
// `node:<nodeId>:<index in effects array>` — so multiple effects on
// the same node (even two targeting the same stat, or two granting
// the same Atrybut) apply and clear independently instead of
// overwriting one another.
//
// Most effect types are numeric and go through setPerkModifier()/
// clearPerkModifiers() (see characterState.js). Some are exceptions,
// each routed to its own small store instead:
//   'attribute' — free text, not a number — setAttributeSource()/
//                 clearAttributeSource() (characterState.js).
//   'currency'  — fungible money — addCurrency() (equipmentState.js).
//   'item'      — a quantity in the inventory — addItemQuantity().
//   'spellUnlock' / 'spellSchoolUnlock' — spellState.js.
//   'attributeChoice' — the player picks attributes from a list.
//
// ------------------------------------------------------------
// PLAYER CHOICES  (attributeChoice / spellSchoolUnlock)
// ------------------------------------------------------------
// These two effect types need the player to pick from a list. That used
// to be a chain of window.prompt() calls that asked for a typed number;
// it's now ONE modal per list (choiceDialog.js) with search/filter/sort,
// checkboxes and description-on-hover.
//
//   collectNodeChoices(node)   — async; opens the dialog(s) and returns
//        { attr: {[effectIndex]: number[]}, spell: {[effectIndex]: id|null} },
//        or `null` if the player pressed "Zrezygnuj z wybierania tego
//        atrybutu" (or Escape). Several 'spellSchoolUnlock' effects with
//        the same schools + max complexity are merged into a single
//        "select N" dialog.
//   nodeNeedsChoices(node)     — true only if a dialog would really open
//        (lets callers keep the plain, synchronous path otherwise).
//
// TreeNode.onClick() calls collectNodeChoices() BEFORE activating the
// node: a `null` result simply means the perk is never activated (i.e.
// it stays deselected). The picks are then handed to
// applyNodeEffect(node, { choices }).
//
// If applyNodeEffect(node) is called WITHOUT picks for a node that needs
// them (edit mode re-applying an already-active node after its effects
// were edited — see Tree.js's addNodeEffect()/updateNodeEffectAt()), the
// dialog is opened from here and the choice effects are applied once it
// closes (cancelling there applies them with no pick).
//
// ------------------------------------------------------------
// RESTORING A PREVIOUS SESSION
// ------------------------------------------------------------
// treePersistence.js remembers which nodes were active across a reload
// and re-activates them via TreeNode.restoreActive(), which calls
// applyNodeEffect(node, { restoring: true, savedChoices, savedSpellChoices }).
//   - 'currency' / 'item' are SKIPPED while restoring (not idempotent,
//     and equipmentState.js already persists them on its own).
//   - 'attributeChoice' / 'spellSchoolUnlock' use the saved picks and
//     never open a dialog.
//
// refreshPerksTaken() rebuilds the sheet's "Wybrane Perki" list from
// scratch based on which tree nodes are CURRENTLY active.
//
// This module imports appState.js (a pure leaf) plus characterState.js,
// equipmentState.js, spellState.js, choiceDialog.js, the sheet modules
// and treePersistence.js — none of which import anything tree-related —
// so TreeNode.js and Tree.js can import this without a cycle.
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

/**
 * A perk that granted currency or items is only allowed to be
 * revoked (deactivated) while the player still has at least as much
 * of that currency/item as the perk originally granted — otherwise
 * it's already been spent/used, and there's nothing left to take
 * back. Returns true immediately for a node with no currency/item
 * effects (or no effects at all).
 *
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

/**
 * @param {import('./TreeNode.js').TreeNode} node
 * @returns {boolean} true only if collectNodeChoices() would really open a dialog for this node.
 */
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
 * Opens the pick-from-a-list dialog(s) for this node's
 * 'attributeChoice' and 'spellSchoolUnlock' effects.
 *
 * @param {import('./TreeNode.js').TreeNode} node
 * @returns {Promise<{attr:{[i:number]:number[]}, spell:{[i:number]:string|null}}|null>}
 *   the picks, keyed by effect index — or null if the player gave up.
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

    const alreadyPicked = new Set(); // don't offer a spell twice across different grants of one perk
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

/**
 * Grants the picked attributes of an 'attributeChoice' effect. The picks
 * are remembered on the TreeNode instance (node._attributeChoiceSelections)
 * so removeNodeEffect() can clear exactly what this activation granted,
 * and persisted via treePersistence.js so a reload restores them.
 *
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{options:{name:string,description:string,bonuses?:object[]}[]}} effect
 * @param {number} index — this effect's position in node.effects
 * @param {number[]|undefined} chosen — option indexes picked (none if undefined)
 */
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

/**
 * Grants the picked spell of a 'spellSchoolUnlock' effect (exactly ONE
 * spell per effect, not every spell matching its schools/complexity).
 * The pick is only accepted if it's still a real, eligible spell.
 *
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{schools:string[], maxComplexity:number}} effect
 * @param {number} index — this effect's position in node.effects
 * @param {string|null|undefined} chosenSpellId
 */
function applySpellSchoolUnlockEffect(node, effect, index, chosenSpellId) {
    const sourceId = `node:${node.nodeId}:${index}`;
    const eligible = getEligibleSpellsForSchoolGrant(effect.schools || [], effect.maxComplexity);
    const chosenId = (chosenSpellId && eligible.some(s => s.id === chosenSpellId)) ? chosenSpellId : null;

    if (!node._spellSchoolChoiceSelections) node._spellSchoolChoiceSelections = {};
    node._spellSchoolChoiceSelections[index] = chosenId;
    saveSpellSchoolChoice(node.nodeId, index, chosenId);

    addSpellSchoolGrant(sourceId, effect.schools || [], effect.maxComplexity, chosenId);
}

function refreshSheets() {
    refreshCharacterSheet();
    refreshEquipmentSheet();
    refreshArcanaSheet();
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
 *   `restoring: true` skips re-granting 'currency'/'item' effects and
 *   takes picks from `savedChoices`/`savedSpellChoices`. `choices` is the
 *   result of collectNodeChoices(). With neither, and a node that needs
 *   picks, the dialog is opened from here (see the header comment).
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
            // Non-numeric — name + free-text description. Idempotent by sourceId.
            setAttributeSource(effect.key, sourceId, effect.description || '', effect.bonuses || []);
        } else if (effect.type === 'attributeChoice') {
            if (deferred) return; // applied once the dialog closes — see below
            applyAttributeChoiceEffect(node, effect, index, attrPick(index));
        } else if (effect.type === 'currency') {
            // NOT idempotent — skipped while restoring (equipmentState.js persists it itself).
            if (!restoring) addCurrency(effect.amount);
        } else if (effect.type === 'item') {
            if (!restoring) addItemQuantity(effect.key, effect.amount);
        } else if (effect.type === 'spellUnlock') {
            addKnownSpell(sourceId, effect.key);
        } else if (effect.type === 'spellSchoolUnlock') {
            if (deferred) return; // applied once the dialog closes — see below
            applySpellSchoolUnlockEffect(node, effect, index, spellPick(index));
        } else {
            // characteristic, skillExperience, skillImprovisation, proficiency and the
            // point-pool grants — replace-by-sourceId, so idempotent.
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
 *
 * NOTE: for a node reached via a normal deactivation click, the
 * caller (TreeNode.onClick) must have already checked
 * canRevokeNodeEffect(node) and only call this when it returned true.
 * Edit-mode's live effect editing (Tree.js) intentionally bypasses
 * that gate — it's a data-editing tool, not "revoking a perk".
 */
export function removeNodeEffect(node) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;

    node.effects.forEach((effect, index) => {
        const sourceId = `node:${node.nodeId}:${index}`;

        if (effect && effect.type === 'currency') {
            // Best-effort refund — may go negative (see equipmentState.js).
            addCurrency(-(Number(effect.amount) || 0));
        } else if (effect && effect.type === 'item') {
            addItemQuantity(effect.key, -(Number(effect.amount) || 0));
        } else if (effect && effect.type === 'spellUnlock') {
            removeKnownSpell(sourceId);
        } else if (effect && effect.type === 'spellSchoolUnlock') {
            removeSpellSchoolGrant(sourceId);
            if (node._spellSchoolChoiceSelections) delete node._spellSchoolChoiceSelections[index];
            clearSpellSchoolChoice(node.nodeId, index);
        } else if (effect && effect.type === 'attributeChoice') {
            // Clear exactly the option(s) THIS activation granted.
            const chosenIndexes = (node._attributeChoiceSelections && node._attributeChoiceSelections[index]) || [];
            chosenIndexes.forEach(optIdx => {
                clearAttributeSource(`node:${node.nodeId}:${index}:${optIdx}`);
            });
            if (node._attributeChoiceSelections) delete node._attributeChoiceSelections[index];
            clearAttributeChoiceSelection(node.nodeId, index);
        } else {
            // Harmless no-op if this effect wasn't of the matching kind.
            clearPerkModifiers(sourceId);
            clearAttributeSource(sourceId);
        }
    });

    refreshSheets();
}

/**
 * Rebuilds the "Wybrane Perki" list on the character sheet from
 * scratch, based on which tree nodes are CURRENTLY active. Call this
 * after every activation/deactivation. Also called once from main.js's
 * sec() after treePersistence.js's restoreActiveNodes().
 */
export function refreshPerksTaken() {
    if (!AppState.tr) return;
    const active = AppState.tr.nodes
    .filter(n => n.nodeActive)
    .map(n => ({ id: n.nodeId, name: n.nodeName, cost: Number(n.nodeCost) || 0 }));
    setPerksTaken(active);
    refreshCharacterSheet();
}
