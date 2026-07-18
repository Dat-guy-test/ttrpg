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
// applyNodeEffect(node)  — called from TreeNode.onClick on activation
// removeNodeEffect(node) — called from TreeNode.onClick on deactivation
//                          (but only once canRevokeNodeEffect() below
//                          has confirmed it's safe — see its header
//                          comment), and from Tree's addNodeEffect()/
//                          removeNodeEffectAt() when an active node's
//                          effects list is edited directly in edit mode.
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
// equipmentState.js, characterSheet.js, and equipmentSheet.js — none
// of which import anything tree-related — so TreeNode.js and Tree.js
// can import this without creating a circular import.
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
import { refreshCharacterSheet } from './characterSheet.js';
import { refreshEquipmentSheet } from './equipmentSheet.js';

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
 * Handles an 'attributeChoice' effect on activation: prompts the
 * player to pick `count` options (each {name, description}) from the
 * node's preset `options` list, then grants each chosen one as an
 * Atrybut via setAttributeSource() — same underlying store as a
 * plain 'attribute' effect, just with the specific name resolved at
 * activation time instead of being baked into the node.
 *
 * The player's choice is remembered on the TreeNode INSTANCE itself
 * (node._attributeChoiceSelections[effectIndex] = [optionIndex, …]) —
 * this is runtime-only bookkeeping so removeNodeEffect() can find and
 * clear exactly the sources this activation granted. It's never
 * serialized (TreeNode.toJSON() only ever exports node.effects), and
 * — matching how every other perk modifier already behaves in this
 * app — the player re-picks each time they (re)activate the node in
 * a session, since nothing about active nodes is persisted anyway.
 *
 * @param {import('./TreeNode.js').TreeNode} node
 * @param {{type:string, count:number, options:{name:string,description:string}[]}} effect
 * @param {number} index — this effect's position in node.effects
 */
function applyAttributeChoiceEffect(node, effect, index) {
    const options = Array.isArray(effect.options) ? effect.options : [];
    if (options.length === 0) return;
    const count = Math.max(1, Math.min(Number(effect.count) || 1, options.length));

    if (!node._attributeChoiceSelections) node._attributeChoiceSelections = {};
    const chosenIndexes = promptAttributeChoice(node.nodeName, options, count);
    node._attributeChoiceSelections[index] = chosenIndexes;

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

/** @param {import('./TreeNode.js').TreeNode} node */
export function applyNodeEffect(node) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;

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
            // setAttributeSource()/CharacterState.attributes.
            setAttributeSource(effect.key, sourceId, effect.description || '', effect.bonuses || []);
        } else if (effect.type === 'attributeChoice') {
            // Player picks `count` named attributes out of this effect's
            // preset `options` list, resolved right now via a prompt. See
            // applyAttributeChoiceEffect() below.
            applyAttributeChoiceEffect(node, effect, index);
        } else if (effect.type === 'currency') {
            // Fungible — just add to the pool. See equipmentState.js's
            // module-level comment for why this isn't a {base,modifiers}
            // field like everything else.
            addCurrency(effect.amount);
        } else if (effect.type === 'item') {
            addItemQuantity(effect.key, effect.amount);
        } else {
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
}

/**
 * Rebuilds the "Wybrane Perki" list on the character sheet from
 * scratch, based on which tree nodes are CURRENTLY active. Call this
 * after every activation/deactivation — unlike apply/removeNodeEffect,
 * it doesn't matter whether the node carries any stat effects; a
 * perk with no stat effect at all should still show up in this list.
 */
export function refreshPerksTaken() {
    if (!AppState.tr) return;
    const active = AppState.tr.nodes
    .filter(n => n.nodeActive)
    .map(n => ({ id: n.nodeId, name: n.nodeName, cost: Number(n.nodeCost) || 0 }));
    setPerksTaken(active);
    refreshCharacterSheet();
}
