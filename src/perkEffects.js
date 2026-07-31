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
// clearPerkModifiers() (see characterState.js). Three types are
// exceptions, each routed to its own small store instead:
//   'attribute' — free text, not a number — setAttributeSource()/
//                 clearAttributeSource() (characterState.js).
//   'currency'  — fungible money, not a "base + perk modifiers"
//                 field — addCurrency() (equipmentState.js).
//   'item'      — a quantity in the inventory, same reasoning as
//                 currency — addItemQuantity() (equipmentState.js).
// Both apply/removeNodeEffect() below handle these with small
// explicit branches rather than trying to force them through the
// numeric-modifier machinery.
//
// applyNodeEffect(node, opts)  — called from TreeNode.onClick on
//                          activation, and from TreeNode.restoreActive()
//                          when re-activating a node that was already
//                          active in a previous session (see below).
// removeNodeEffect(node) — called from TreeNode.onClick on deactivation
//                          (but only once canRevokeNodeEffect() below
//                          has confirmed it's safe — see its header
//                          comment), and from Tree's addNodeEffect()/
//                          removeNodeEffectAt() when an active node's
//                          effects list is edited directly in edit mode.
//
// ------------------------------------------------------------
// RESTORING A PREVIOUS SESSION
// ------------------------------------------------------------
// treePersistence.js now remembers which nodes were active across a
// reload (see its header comment) and re-activates them via
// TreeNode.restoreActive(), which calls applyNodeEffect(node,
// { restoring: true, savedChoices }) instead of the plain
// applyNodeEffect(node) a fresh click uses. Two effect types need to
// behave differently while restoring:
//   - 'currency' / 'item': SKIPPED while restoring. Unlike every
//     other effect type, these aren't idempotent (calling
//     addCurrency()/addItemQuantity() twice adds twice) — but
//     equipmentState.js's currency/inventory are ALREADY fully
//     persisted on their own, so re-granting them here on every
//     reload would double them. Every other effect type IS
//     idempotent (setPerkModifier()/setAttributeSource()/
//     addKnownSpell()/addSpellSchoolGrant() all replace-by-sourceId),
//     so those are always re-applied — that's in fact the ONLY thing
//     that rebuilds Charakterystyki/Umiejętności modifiers, Wprawa,
//     and Atrybuty after a reload, since those are deliberately never
//     written to characterState.js's own localStorage key.
//   - 'attributeChoice': normally prompts the player to pick. While
//     restoring, `opts.savedChoices` (keyed by this effect's index)
//     is used instead, so the player is never re-asked just because
//     the page reloaded.
//
// Both apply/removeNodeEffect are safe to call on a node with no
// effects (no-op).
//
// refreshPerksTaken() rebuilds the sheet's "Wybrane Perki" list from
// scratch based on which tree nodes are CURRENTLY active — called
// unconditionally on every activation/deactivation (regardless of
// whether the node carries any stat effects), so it lives as its own
// function rather than being folded into apply/removeNodeEffect above.
//
// This module imports appState.js (a pure leaf — see its own header
// comment — so this creates no cycle) plus characterState.js,
// equipmentState.js, characterSheet.js, equipmentSheet.js, and
// treePersistence.js — none of which import anything tree-related —
// so TreeNode.js and Tree.js can import this without creating a
// circular import.
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

/**
 * A perk that granted currency or items is only allowed to be
 * revoked (deactivated) while the player still has at least as much
 * of that currency/item as the perk originally granted — otherwise
 * it's already been spent/used, and there's nothing left to take
 * back. Returns true immediately for a node with no currency/item
 * effects (or no effects at all); every other effect type is
 * revocable regardless of current character-sheet state.
 *
 * Called from TreeNode.onClick BEFORE deactivating a node and BEFORE
 * calling removeNodeEffect() — if this returns false, the node should
 * stay active and removeNodeEffect() must not be called.
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

/**
 * Handles an 'attributeChoice' effect on activation: either prompts
 * the player to pick `count` options (each {name, description}) from
 * the node's preset `options` list, or — when `presetIndexes` is
 * given (restoring a previous session; see treePersistence.js) —
 * reuses those exact indexes without prompting at all. Either way,
 * each chosen option is granted as an Atrybut via setAttributeSource()
 * — same underlying store as a plain 'attribute' effect, just with
 * the specific name resolved at activation (or restore) time instead
 * of being baked into the node.
 *
 * The player's choice is remembered on the TreeNode INSTANCE itself
 * (node._attributeChoiceSelections[effectIndex] = [optionIndex, …])
 * so removeNodeEffect() can find and clear exactly the sources this
 * activation granted, AND persisted via
 * treePersistence.js's saveAttributeChoiceSelection() so a future
 * reload can restore the exact same choice without re-prompting.
 *
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{type:string, count:number, options:{name:string,description:string}[]}} effect
 * @param {number} index — this effect's position in node.effects
 * @param {number[]} [presetIndexes] — reuse these option indexes instead of prompting (used when restoring a previous session)
 */
function applyAttributeChoiceEffect(node, effect, index, presetIndexes) {
    const options = Array.isArray(effect.options) ? effect.options : [];
    if (options.length === 0) return;
    const count = Math.max(1, Math.min(Number(effect.count) || 1, options.length));

    if (!node._attributeChoiceSelections) node._attributeChoiceSelections = {};

    const chosenIndexes = Array.isArray(presetIndexes)
        ? presetIndexes.filter(i => Number.isInteger(i) && i >= 0 && i < options.length)
        : promptAttributeChoice(node.nodeName, options, count);

    node._attributeChoiceSelections[index] = chosenIndexes;
    saveAttributeChoiceSelection(node.nodeId, index, chosenIndexes);

    chosenIndexes.forEach(optIdx => {
        const opt = options[optIdx];
        if (!opt) return;
        setAttributeSource(opt.name, `node:${node.nodeId}:${index}:${optIdx}`, opt.description || '', opt.bonuses || []);
    });
}

/**
 * Prompts the player (via window.prompt, one number at a time) to pick
 * `count` distinct options out of `options`. Cancelling the prompt
 * stops asking and returns whatever's been picked so far (possibly
 * fewer than `count`, possibly none) rather than blocking activation.
 * @returns {number[]} chosen option indexes
 */
function promptAttributeChoice(nodeName, options, count) {
    const listText = options.map((o, i) => `${i + 1}. ${o.name}`).join('\n');
    const chosen = new Set();

    while (chosen.size < count) {
        const remaining = count - chosen.size;
        const alreadyText = chosen.size > 0
            ? `\nWybrane: ${[...chosen].map(i => options[i].name).join(', ')}`
            : '';
        const answer = window.prompt(
            `"${nodeName}" — wybierz jeszcze ${remaining} atrybut${remaining === 1 ? '' : 'y'} spośród:\n${listText}${alreadyText}\n\nWpisz numer opcji:`
        );
        if (answer === null) break; // cancelled — keep whatever was already picked

        const n = Number(String(answer).trim());
        if (!Number.isInteger(n) || n < 1 || n > options.length) {
            window.alert('Nieprawidłowy numer — spróbuj ponownie.');
            continue;
        }
        if (chosen.has(n - 1)) {
            window.alert('Ten atrybut został już wybrany.');
            continue;
        }
        chosen.add(n - 1);
    }
    return [...chosen];
}

/**
 * Prompts the player (via window.prompt) to pick exactly ONE spell
 * out of `spells`. Cancelling the prompt, or entering an invalid
 * number, results in no spell being chosen (returns null) rather than
 * blocking activation — same reasoning as promptAttributeChoice()'s
 * cancel handling above.
 * @param {string} nodeName
 * @param {object[]} spells
 * @returns {string|null} the chosen spell's id, or null if none was picked
 */
function promptSpellSchoolChoice(nodeName, spells) {
    const listText = spells.map((s, i) => `${i + 1}. ${s.name} (złożoność ${s.complexity ?? 0})`).join('\n');
    const answer = window.prompt(
        `"${nodeName}" — wybierz JEDNO zaklęcie do odblokowania spośród:\n${listText}\n\nWpisz numer zaklęcia:`
    );
    if (answer === null) return null; // cancelled — nothing chosen

    const n = Number(String(answer).trim());
    if (!Number.isInteger(n) || n < 1 || n > spells.length) {
        window.alert('Nieprawidłowy numer — nie odblokowano żadnego zaklęcia.');
        return null;
    }
    return spells[n - 1].id;
}

/**
 * Handles a 'spellSchoolUnlock' effect on activation. This effect
 * grants exactly ONE spell — not every compendium spell matching its
 * schools/maxComplexity — so this either prompts the player to pick
 * one out of the currently-eligible pool, or — when `presetSpellId`
 * is given while restoring a previous session (see treePersistence.js) —
 * reuses that exact choice without prompting, provided it's still a
 * valid, eligible pick (a spell could have been deleted, or edited
 * out of the matching schools/complexity, since it was chosen).
 *
 * The chosen spell id is remembered on the TreeNode INSTANCE itself
 * (node._spellSchoolChoiceSelections[index] = spellId) so
 * removeNodeEffect() doesn't need any extra bookkeeping beyond
 * clearing this grant, AND persisted via treePersistence.js's
 * saveSpellSchoolChoice() so a future reload restores the same spell
 * without re-prompting.
 *
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{type:string, schools:string[], maxComplexity:number}} effect
 * @param {number} index — this effect's position in node.effects
 * @param {string|null|undefined} presetSpellId — reuse this exact spell instead of prompting (used when restoring a previous session)
 * @param {boolean} restoring — true while restoring a previous session; suppresses the prompt entirely
 */
function applySpellSchoolUnlockEffect(node, effect, index, presetSpellId, restoring) {
    const sourceId = `node:${node.nodeId}:${index}`;
    const eligible = getEligibleSpellsForSchoolGrant(effect.schools || [], effect.maxComplexity);

    let chosenId = null;
    if (restoring) {
        // Never prompt while restoring — reuse the saved pick only if it's
        // still a real, eligible spell; otherwise leave it unchosen rather
        // than silently re-prompting or auto-picking a different one.
        chosenId = (presetSpellId && eligible.some(s => s.id === presetSpellId)) ? presetSpellId : null;
    } else if (eligible.length > 0) {
        chosenId = promptSpellSchoolChoice(node.nodeName, eligible);
    }

    if (!node._spellSchoolChoiceSelections) node._spellSchoolChoiceSelections = {};
    node._spellSchoolChoiceSelections[index] = chosenId;
    saveSpellSchoolChoice(node.nodeId, index, chosenId);

    addSpellSchoolGrant(sourceId, effect.schools || [], effect.maxComplexity, chosenId);
}

/**
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{restoring?:boolean, savedChoices?:{[effectIndex:string]:number[]}, savedSpellChoices?:{[effectIndex:string]:string|null}}} [opts]
 *   `restoring: true` skips re-granting 'currency'/'item' effects
 *   (equipmentState.js already persists those directly — see this
 *   module's header comment), `savedChoices` supplies
 *   'attributeChoice' picks, and `savedSpellChoices` supplies
 *   'spellSchoolUnlock' picks, so restoring never re-prompts.
 */
export function applyNodeEffect(node, opts = {}) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;
    const restoring = !!opts.restoring;

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
            // Atrybuty are non-numeric — name + free-text description —
            // so they're granted through their own source-tracked store
            // instead of setPerkModifier(). See characterState.js's
            // setAttributeSource()/CharacterState.attributes. Idempotent
            // by sourceId, so safe to re-run every restore.
            setAttributeSource(effect.key, sourceId, effect.description || '', effect.bonuses || []);
        } else if (effect.type === 'attributeChoice') {
            // Player picks `count` named attributes out of this effect's
            // preset `options` list — resolved right now via a prompt, or
            // reused from a saved choice while restoring. See
            // applyAttributeChoiceEffect() below.
            applyAttributeChoiceEffect(node, effect, index, opts.savedChoices ? opts.savedChoices[index] : undefined);
        } else if (effect.type === 'currency') {
            // Fungible — just add to the pool. See equipmentState.js's
            // module-level comment for why this isn't a {base,modifiers}
            // field like everything else. NOT idempotent (adds every
            // call) — equipmentState.js's currency is already fully
            // persisted on its own, so this must be skipped while
            // restoring a previous session or it would double up.
            if (!restoring) addCurrency(effect.amount);
        } else if (effect.type === 'item') {
            // Same reasoning as 'currency' — skip while restoring.
            if (!restoring) addItemQuantity(effect.key, effect.amount);
        } else if (effect.type === 'spellUnlock') {
            // Grants access to one specific compendium spell. Presence-only
            // (known or not), same reasoning as 'attribute' — routed to its
            // own store instead of setPerkModifier(). See spellState.js.
            // Idempotent by sourceId, safe to re-run every restore.
            addKnownSpell(sourceId, effect.key);
        } else if (effect.type === 'spellSchoolUnlock') {
            // Grants exactly ONE spell out of every compendium spell
            // matching one or more schools up to a max complexity — the
            // player picks which one at activation time (or reuses a
            // saved pick while restoring). See
            // applySpellSchoolUnlockEffect() above. Idempotent by
            // sourceId, safe to re-run every restore.
            applySpellSchoolUnlockEffect(node, effect, index, opts.savedSpellChoices ? opts.savedSpellChoices[index] : null, restoring);
        } else {
            // Every remaining EFFECT_TYPES entry (characteristic,
            // skillExperience, skillImprovisation, proficiency, and the
            // point-pool grants) goes through setPerkModifier(), which
            // REPLACES this sourceId's modifier rather than stacking a
            // new one — idempotent, so safe (in fact necessary) to
            // re-apply every time a session restores.
            setPerkModifier(
                effectDef.fieldPath(effect.key),
                sourceId,
                effect.amount,
                `${effectDef.label}: ${node.nodeName}`
            );
        }
    });

    refreshCharacterSheet();
    refreshEquipmentSheet();
    refreshArcanaSheet();
}

/**
 * @param {import('./TreeNode.js').TreeNode} node
 *
 * NOTE: for a node reached via a normal deactivation click, the
 * caller (TreeNode.onClick) must have already checked
 * canRevokeNodeEffect(node) and only call this when it returned true
 * — currency/item effects are otherwise refunded unconditionally
 * here (best-effort, can go negative), which is exactly the
 * behaviour that check exists to prevent from being reached in the
 * normal play flow. Edit-mode's live effect editing (Tree.js's
 * addNodeEffect()/removeNodeEffectAt()) intentionally bypasses that
 * gate — it's a data-editing tool, not "revoking a perk".
 */
export function removeNodeEffect(node) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;

    node.effects.forEach((effect, index) => {
        const sourceId = `node:${node.nodeId}:${index}`;

        if (effect && effect.type === 'currency') {
            // Best-effort refund — see equipmentState.js's module-level
            // comment: if the player already spent below this amount the
            // balance can go negative rather than being clamped, since
            // clamping would silently make deactivating a perk "free".
            // In the normal play flow this branch only runs once
            // canRevokeNodeEffect() has confirmed sufficient balance.
            addCurrency(-(Number(effect.amount) || 0));
        } else if (effect && effect.type === 'item') {
            addItemQuantity(effect.key, -(Number(effect.amount) || 0));
        } else if (effect && effect.type === 'spellUnlock') {
            removeKnownSpell(sourceId);
        } else if (effect && effect.type === 'spellSchoolUnlock') {
            removeSpellSchoolGrant(sourceId);
            // Also drop the instance- and storage-level bookkeeping of
            // which spell THIS activation picked — mirrors
            // 'attributeChoice''s cleanup just below, and prevents a
            // stale pick from being replayed if this node is reactivated
            // after a reload before this session's state catches up.
            if (node._spellSchoolChoiceSelections) delete node._spellSchoolChoiceSelections[index];
            clearSpellSchoolChoice(node.nodeId, index);
        } else if (effect && effect.type === 'attributeChoice') {
            // Clear exactly the option(s) THIS activation granted — see
            // applyAttributeChoiceEffect()'s comment on
            // node._attributeChoiceSelections for why that bookkeeping
            // lives on the TreeNode instance rather than in effect data.
            const chosenIndexes = (node._attributeChoiceSelections && node._attributeChoiceSelections[index]) || [];
            chosenIndexes.forEach(optIdx => {
                clearAttributeSource(`node:${node.nodeId}:${index}:${optIdx}`);
            });
            if (node._attributeChoiceSelections) delete node._attributeChoiceSelections[index];
            // Also drop the persisted selection (see treePersistence.js) —
            // otherwise a stale choice would linger in storage and could
            // be replayed if this same node were ever reactivated after a
            // reload before this session's in-memory state caught up.
            clearAttributeChoiceSelection(node.nodeId, index);
        } else {
            // Harmless no-op if this particular effect wasn't of the
            // matching kind — a numeric effect's sourceId was never
            // registered with attributes, and vice versa.
            clearPerkModifiers(sourceId);
            clearAttributeSource(sourceId);
        }
    });

    refreshCharacterSheet();
    refreshEquipmentSheet();
    refreshArcanaSheet();
}

/**
 * Rebuilds the "Wybrane Perki" list on the character sheet from
 * scratch, based on which tree nodes are CURRENTLY active. Call this
 * after every activation/deactivation — unlike apply/removeNodeEffect,
 * it doesn't matter whether the node carries any stat effects; a
 * perk with no stat effect at all should still show up in this list.
 * Also called once from main.js's sec() after treePersistence.js's
 * restoreActiveNodes() re-activates a previous session's perks.
 */
export function refreshPerksTaken() {
    if (!AppState.tr) return;
    const active = AppState.tr.nodes
    .filter(n => n.nodeActive)
    .map(n => ({ id: n.nodeId, name: n.nodeName, cost: Number(n.nodeCost) || 0 }));
    setPerksTaken(active);
    refreshCharacterSheet();
}
