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
// removeNodeEffect(node) — called from TreeNode.onClick on deactivation,
//                          and from Tree's addNodeEffect()/
//                          removeNodeEffectAt() when an active node's
//                          effects list is edited
//
// Both are safe to call on a node with no effects (no-op).
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
import { addCurrency, addItemQuantity } from './equipmentState.js';
import { refreshCharacterSheet } from './characterSheet.js';
import { refreshEquipmentSheet } from './equipmentSheet.js';

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
            setAttributeSource(effect.key, sourceId, effect.description || '');
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

/** @param {import('./TreeNode.js').TreeNode} node */
export function removeNodeEffect(node) {
    if (!Array.isArray(node.effects) || node.effects.length === 0) return;

    node.effects.forEach((effect, index) => {
        const sourceId = `node:${node.nodeId}:${index}`;

        if (effect && effect.type === 'currency') {
            // Best-effort refund — see equipmentState.js's module-level
            // comment: if the player already spent below this amount the
            // balance can go negative rather than being clamped, since
            // clamping would silently make deactivating a perk "free".
            addCurrency(-(Number(effect.amount) || 0));
        } else if (effect && effect.type === 'item') {
            addItemQuantity(effect.key, -(Number(effect.amount) || 0));
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
