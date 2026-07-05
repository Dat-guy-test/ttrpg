// ============================================================
// EQUIPMENT STATE
//
// Data model + persistence for the Equipment tab. Same singleton
// pattern as characterState.js: one mutable object, imported and
// written to directly by whatever module needs it.
//
// Currency and inventory quantities are plain player-adjustable
// numbers (like resources.actionPoints.current in characterState.js),
// NOT perk-modifier {base, modifiers} fields — money/items are
// fungible and get spent, so there's no clean "total minus this
// perk's contribution" to subtract once some has already been used.
// A perk that grants currency/items just adds to the pool once, on
// activation (see perkEffects.js), and — best effort — subtracts the
// same amount back on deactivation. If the player already spent
// below that amount the balance can go negative; that's treated as
// acceptable bookkeeping fiction rather than something to clamp,
// since clamping would silently make deactivating a perk "free".
// ============================================================

import itemsData from './items.json';

export const ITEMS = itemsData.items;

/** [{key, label}] shape EFFECT_TYPES / editMode.js's dropdown expects. */
export const ITEMS_CONFIG = ITEMS.map(i => ({ key: i.id, label: i.name }));

export function getItemById(id) {
    return ITEMS.find(i => i.id === id) || null;
}

const STORAGE_KEY = 'ttrpgEquipment.v1';

function buildDefaultState() {
    return {
        currency: 0,
        inventory: {}, // { [itemId]: quantity }
    };
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildDefaultState();
        const saved = JSON.parse(raw);
        const out = buildDefaultState();
        out.currency = Number(saved.currency) || 0;
        if (saved.inventory && typeof saved.inventory === 'object') {
            for (const [itemId, qty] of Object.entries(saved.inventory)) {
                const n = Number(qty) || 0;
                if (n !== 0) out.inventory[itemId] = n;
            }
        }
        return out;
    } catch (e) {
        console.error('EquipmentState: failed to load — starting fresh.', e);
        return buildDefaultState();
    }
}

export const EquipmentState = load();

export function saveEquipmentState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(EquipmentState));
    } catch (e) {
        console.error('EquipmentState: failed to save.', e);
    }
}

export function resetEquipmentState() {
    Object.assign(EquipmentState, buildDefaultState());
    saveEquipmentState();
}

// ---- Currency -------------------------------------------------------------

export function getCurrency() {
    return EquipmentState.currency;
}

/** Adds (or, with a negative amount, removes) currency. Used by both perk grants and manual/player edits. */
export function addCurrency(amount) {
    EquipmentState.currency = (Number(EquipmentState.currency) || 0) + (Number(amount) || 0);
    saveEquipmentState();
}

/** Player directly typing a new balance (e.g. after a trade adjudicated by the GM). */
export function setCurrency(value) {
    const n = Number(value);
    EquipmentState.currency = Number.isFinite(n) ? n : 0;
    saveEquipmentState();
}

// ---- Inventory --------------------------------------------------------------

export function getItemQuantity(itemId) {
    return EquipmentState.inventory[itemId] || 0;
}

/** Adds (or removes, with a negative amount) copies of an item. Drops the key entirely at 0 so "owned items" stays a clean list. */
export function addItemQuantity(itemId, amount) {
    const next = getItemQuantity(itemId) + (Number(amount) || 0);
    if (next <= 0) {
        delete EquipmentState.inventory[itemId];
    } else {
        EquipmentState.inventory[itemId] = next;
    }
    saveEquipmentState();
}

export function setItemQuantity(itemId, value) {
    const n = Number(value);
    addItemQuantity(itemId, (Number.isFinite(n) ? n : 0) - getItemQuantity(itemId));
}

/** @returns {{id,name,desc,price,category,quantity}[]} every item currently owned (quantity > 0). */
export function getOwnedItems() {
    return Object.entries(EquipmentState.inventory)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({
            ...(getItemById(id) || { id, name: id, desc: '(przedmiot usunięty z bazy danych)', price: 0, category: '?' }),
            quantity: qty,
        }));
}

/**
 * Spends `item.price` from currency and adds one copy of it to the
 * inventory. Used by the Equipment tab's "Kup" (buy) button in market
 * mode. Refuses — returning false — if the balance can't cover it.
 */
export function buyItem(itemId) {
    const item = getItemById(itemId);
    if (!item) return false;
    if (EquipmentState.currency < item.price) return false;
    addCurrency(-item.price);
    addItemQuantity(itemId, 1);
    return true;
}
