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
//
// ------------------------------------------------------------
// CUSTOM ITEMS
// ------------------------------------------------------------
// items.json's `ITEMS` array is treated as read-only built-in data —
// nothing here ever mutates it. Items created via the Equipment
// tab's "Tryb Edycji" (see itemEditor.js) are stored separately, in
// their own localStorage key, and merged with the built-ins at read
// time via getAllItems()/getItemById(). This is exactly the same
// "don't touch the source file, work in a parallel store, export to
// merge by hand later" pattern editMode.js already uses for
// nodes.json.
//
// ------------------------------------------------------------
// BUILT-IN ITEM OVERRIDES
// ------------------------------------------------------------
// Editing an EXISTING items.json item works the same way: ITEMS is
// still never mutated in place. Instead, an edited copy is stored in
// its own localStorage key, keyed by the built-in item's id (see the
// "BUILT-IN ITEM OVERRIDES" section further down). getItemById()/
// getAllItems() transparently prefer the override the moment one
// exists, so the rest of the app never needs to know or care whether
// a given built-in item is "as shipped" or "as edited".
// ============================================================

import itemsData from './items.json';

// items.json is normally shaped { "items": [...] }, but it's an easy
// mix-up to instead paste in the plain array that the Equipment tab's
// "Eksportuj przedmioty" button produces for custom-items.json (see
// itemEditor.js's export handler) — accepting both shapes here means
// that mistake degrades gracefully instead of crashing every module
// that reads ITEMS/ITEMS_CONFIG at load time.
export const ITEMS = Array.isArray(itemsData)
    ? itemsData
    : (Array.isArray(itemsData?.items) ? itemsData.items : []);

if (!Array.isArray(itemsData) && !Array.isArray(itemsData?.items)) {
    console.error('EquipmentState: items.json is neither a bare array nor a { items: [...] } object — treating it as empty. Check the file\'s shape.');
}

// ITEMS_CONFIG is intentionally a *mutable* array (never reassigned)
// — characterState.js's EFFECT_TYPES 'item' entry holds a direct
// reference to this exact array as its `options` list. Pushing new
// custom items into it in place (see addCustomItem() below) is what
// lets a freshly-created custom item show up in the perk editor's
// "Przyznaj Przedmiot" dropdown without characterState.js ever
// needing to know custom items exist.
export const ITEMS_CONFIG = ITEMS.map(i => ({ key: i.id, label: i.name }));


// ------------------------------------------------------------
// CURRENCY
// ------------------------------------------------------------
// Stored internally as a single integer: the number of Nitki
// Konstancjum (the smallest denomination). The other two
// denominations are pure display conversions, computed on the fly —
// never stored separately, so they can never drift out of sync with
// the underlying total.
export const CURRENCY_DENOMINATIONS = [
    { key: 'pieces',  label: 'Sztuki Konstancjum',      perStrand: 500 },
    { key: 'rings',   label: 'Pierścienie Konstancjum',  perStrand: 5 },
    { key: 'strands', label: 'Nitki Konstancjum',        perStrand: 1 },
];

/**
 * Breaks an amount of Nitki Konstancjum into its three denominations.
 * @param {number} amount
 * @returns {{pieces:number, rings:number, strands:number}}
 */
export function formatCurrencyParts(amount) {
    const total = Math.max(0, Math.trunc(Number(amount) || 0));
    const pieces = Math.floor(total / 500);
    const afterPieces = total % 500;
    const rings = Math.floor(afterPieces / 5);
    const strands = afterPieces % 5;
    return { pieces, rings, strands };
}

/**
 * Compact display string, e.g. "2 Szt., 3 Pierść., 1 Nitka" — zero
 * denominations are omitted, except strands stays if it's the only
 * non-zero part left (so an amount of 0 still shows "0 Nitek"
 * instead of an empty string).
 * @param {number} amount
 */
export function formatCurrencyShort(amount) {
    const { pieces, rings, strands } = formatCurrencyParts(amount);
    const parts = [];
    if (pieces) parts.push(`${pieces} Szt.`);
    if (rings) parts.push(`${rings} Pierść.`);
    if (strands || parts.length === 0) parts.push(`${strands} Nitek`);
    return parts.join(', ');
}

// ------------------------------------------------------------
// ITEM PRICE — "Nie Sprzedawany" (Not for Sale)
// ------------------------------------------------------------
// An item's `price` is normally a non-negative integer (Nitki
// Konstancjum), but it can instead be this sentinel string, meaning
// the item simply isn't offered on the market. It's still fully
// obtainable through every other channel (perk grants, splitting a
// set that contains it, manually adjusting quantity, …) — this only
// gates buyItem()/the market "Kup" button.
//
// Defined here (rather than in itemSchema.js) specifically to avoid
// a circular import: itemSchema.js imports ABILITIES_CONFIG from
// characterState.js, and characterState.js imports ITEMS_CONFIG from
// THIS file — so this file must never import FROM itemSchema.js.
// itemEditor.js and equipmentSheet.js (both leaves, imported by
// nothing) are free to import this constant from here instead.
export const NOT_FOR_SALE = 'notForSale';

/** True if `price` is the "Nie Sprzedawany" sentinel rather than a numeric price. */
export function isNotForSale(price) {
    return price === NOT_FOR_SALE;
}

/**
 * Display string for an item's price: "Nie Sprzedawany" for the
 * sentinel, otherwise the same denomination breakdown formatCurrencyShort()
 * uses for the player's own currency total.
 * @param {number|string} price
 */
export function formatItemPrice(price) {
    if (isNotForSale(price)) return 'Nie Sprzedawany';
    return formatCurrencyShort(price);
}

const STORAGE_KEY = 'ttrpgEquipment.v1';
const CUSTOM_ITEMS_STORAGE_KEY = 'ttrpgCustomItems.v1';
const ITEM_OVERRIDES_STORAGE_KEY = 'ttrpgItemOverrides.v1';
const ITEM_DELETIONS_STORAGE_KEY = 'ttrpgDeletedBuiltInItems.v1';

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

/** Adds (or, with a negative amount, removes) currency (in Nitki Konstancjum). Used by both perk grants and manual/player edits. */
export function addCurrency(amount) {
    EquipmentState.currency = (Number(EquipmentState.currency) || 0) + (Number(amount) || 0);
    saveEquipmentState();
}


// ------------------------------------------------------------
// CUSTOM ITEMS  (created via the Equipment tab's Tryb Edycji)
// ------------------------------------------------------------

function loadCustomItems() {
    try {
        const raw = localStorage.getItem(CUSTOM_ITEMS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('EquipmentState: failed to load custom items — starting fresh.', e);
        return [];
    }
}

let customItems = loadCustomItems();

function saveCustomItems() {
    try {
        localStorage.setItem(CUSTOM_ITEMS_STORAGE_KEY, JSON.stringify(customItems));
    } catch (e) {
        console.error('EquipmentState: failed to save custom items.', e);
    }
}

// Once a custom item's id has been folded into the built-in items.json
// (e.g. via "Eksportuj items.json (wbudowane + własne)" in Tryb Edycji,
// followed by replacing the project's items.json with the result), the
// localStorage copy becomes a stale duplicate of something that's now
// built-in. Left alone it would make that item appear twice in
// getAllItems() (and therefore twice in the Rynek list), while Tryb
// Edycji would keep treating it as "own"/editable even though the real
// source of truth is now the built-in file. Any custom item whose id
// already exists in ITEMS is dropped automatically the moment this
// module loads — no manual cleanup needed after a merge-and-replace.
(function pruneMergedCustomItems() {
    const before = customItems.length;
    customItems = customItems.filter(i => !ITEMS.some(b => b.id === i.id));
    if (customItems.length !== before) saveCustomItems();
})();

// ITEMS_CONFIG only seeded itself from the built-ins at module-load time
// (see its definition near the top of this file); custom items restored
// from localStorage were never folded in, so they'd silently vanish from
// the perk editor's "Przyznaj Przedmiot" dropdown after every page
// reload even though they still showed up everywhere else. Backfilling
// here (after the prune above, so an already-merged item isn't listed
// twice there either) closes that gap.
for (const item of customItems) {
    if (!ITEMS_CONFIG.some(c => c.key === item.id)) {
        ITEMS_CONFIG.push({ key: item.id, label: item.name });
    }
}

/** @returns {object[]} only the player-created custom items (not the items.json built-ins). Used by the "Eksportuj przedmioty" button. */
export function getCustomItems() {
    return customItems;
}


// ------------------------------------------------------------
// BUILT-IN ITEM OVERRIDES  (editing an EXISTING items.json item)
// ------------------------------------------------------------
// items.json's ITEMS array is still never mutated in place — see the
// module header comment. Instead, editing a built-in item stores a
// full replacement copy, keyed by that item's own id, in its own
// localStorage key. getItemById()/getAllItems() transparently prefer
// the override over the shipped original the moment one exists, so
// nothing else in the app needs to know whether a given built-in
// item is "as shipped" or "as edited" — it always just sees whatever
// is current.
//
// Exporting items.json (see itemEditor.js's export button) bakes
// every current override into the exported file — replacing the
// project's items.json with that export is how an override becomes
// permanent, at which point the localStorage copy is redundant (same
// "export, then replace the file by hand" workflow the tree editor
// and custom items already use).

function loadItemOverrides() {
    try {
        const raw = localStorage.getItem(ITEM_OVERRIDES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        console.error('EquipmentState: failed to load built-in item overrides — starting fresh.', e);
        return {};
    }
}

let itemOverrides = loadItemOverrides(); // { [builtInItemId]: item }

function saveItemOverrides() {
    try {
        localStorage.setItem(ITEM_OVERRIDES_STORAGE_KEY, JSON.stringify(itemOverrides));
    } catch (e) {
        console.error('EquipmentState: failed to save built-in item overrides.', e);
    }
}

// If a previously-overridden id has since disappeared from items.json
// (the built-in file was hand-edited/replaced and that item removed),
// the stale override would otherwise sit forever, pointing at nothing
// — drop it, mirroring pruneMergedCustomItems()'s reasoning above.
(function pruneOrphanedOverrides() {
    const before = Object.keys(itemOverrides).length;
    for (const id of Object.keys(itemOverrides)) {
        if (!ITEMS.some(i => i.id === id)) delete itemOverrides[id];
    }
    if (Object.keys(itemOverrides).length !== before) saveItemOverrides();
})();

/** True if `id` belongs to a built-in items.json item (whether or not it currently has an edit override applied). */
export function isBuiltInItemId(id) {
    return ITEMS.some(i => i.id === id);
}

/** True if a built-in item currently has a player-made edit override applied. */
export function hasBuiltInOverride(id) {
    return Object.prototype.hasOwnProperty.call(itemOverrides, id);
}

/**
 * Saves an edited copy of a BUILT-IN (items.json) item as an
 * override. Throws if `id` doesn't actually belong to a built-in
 * item — that's what distinguishes this from updateCustomItem();
 * a custom item is edited in place instead.
 * @param {string} id
 * @param {object} item
 * @returns {object} the stored (override) item
 */
export function updateBuiltInItem(id, item) {
    if (!ITEMS.some(i => i.id === id)) {
        throw new Error(`"${id}" nie jest przedmiotem wbudowanym — nie można nadpisać.`);
    }
    const stored = { ...item, id };
    itemOverrides[id] = stored;
    saveItemOverrides();
    return stored;
}

/** Discards a built-in item's override, reverting it back to the items.json original. No-op (returns false) if it wasn't overridden. */
export function resetBuiltInItemOverride(id) {
    if (!Object.prototype.hasOwnProperty.call(itemOverrides, id)) return false;
    delete itemOverrides[id];
    saveItemOverrides();
    return true;
}


// ------------------------------------------------------------
// BUILT-IN ITEM DELETIONS  ("deleting" an items.json item)
// ------------------------------------------------------------
// A built-in item can't be truly removed without editing items.json
// by hand, and this module never touches that file directly (same
// rule as everywhere else here). Instead, "deleting" a built-in item
// records its id in this set — every read path (getAllItems(),
// getItemById(), ITEMS_CONFIG) treats a deleted id as if it didn't
// exist, so it vanishes from the inventory, the market, the perk
// editor's "Przyznaj Przedmiot" dropdown, and item.json exports —
// everywhere — without the shipped file ever being touched. Any
// override for that id is dropped at the same time, since it would
// otherwise be silently resurrected the moment the item was restored
// (see restoreBuiltInItem()).
//
// This mirrors the override mechanism above almost exactly — its own
// localStorage key, its own prune-on-load, its own set of accessors —
// deliberately kept as a SEPARATE store (rather than folding it into
// itemOverrides as e.g. `{ deleted: true }`) so "is this overridden"
// and "is this deleted" stay two independent, individually-toggleable
// facts about a built-in item instead of one field doing double duty.

function loadDeletedBuiltInIds() {
    try {
        const raw = localStorage.getItem(ITEM_DELETIONS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
        console.error('EquipmentState: failed to load deleted built-in items — starting fresh.', e);
        return new Set();
    }
}

let deletedBuiltInIds = loadDeletedBuiltInIds();

function saveDeletedBuiltInIds() {
    try {
        localStorage.setItem(ITEM_DELETIONS_STORAGE_KEY, JSON.stringify([...deletedBuiltInIds]));
    } catch (e) {
        console.error('EquipmentState: failed to save deleted built-in items.', e);
    }
}

// Same reasoning as pruneOrphanedOverrides() above: if items.json was
// hand-edited/replaced and a previously-deleted id no longer exists at
// all, there's nothing left to keep "deleted" — drop the stale entry.
(function pruneStaleDeletions() {
    const before = deletedBuiltInIds.size;
    for (const id of deletedBuiltInIds) {
        if (!ITEMS.some(i => i.id === id)) deletedBuiltInIds.delete(id);
    }
    if (deletedBuiltInIds.size !== before) saveDeletedBuiltInIds();
})();

/** True if `id` belongs to a built-in item that's currently soft-deleted. */
export function isBuiltInItemDeleted(id) {
    return deletedBuiltInIds.has(id);
}

/**
 * Soft-deletes a built-in (items.json) item: hides it from
 * getAllItems()/getItemById()/ITEMS_CONFIG/exports without touching
 * items.json itself. Also clears any override for this id, since a
 * leftover override would otherwise reappear the moment the item is
 * restored. Throws if `id` doesn't belong to a real built-in item —
 * a custom item is removed via removeCustomItem() instead.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteBuiltInItem(id) {
    if (!ITEMS.some(i => i.id === id)) {
        throw new Error(`"${id}" nie jest przedmiotem wbudowanym — nie można go usunąć w ten sposób.`);
    }
    deletedBuiltInIds.add(id);
    saveDeletedBuiltInIds();

    if (Object.prototype.hasOwnProperty.call(itemOverrides, id)) {
        delete itemOverrides[id];
        saveItemOverrides();
    }

    const idx = ITEMS_CONFIG.findIndex(c => c.key === id);
    if (idx !== -1) ITEMS_CONFIG.splice(idx, 1);

    return true;
}

/** Un-deletes a previously soft-deleted built-in item, restoring the shipped items.json version (any override was discarded at delete time). No-op (returns false) if it wasn't deleted. */
export function restoreBuiltInItem(id) {
    if (!deletedBuiltInIds.has(id)) return false;
    deletedBuiltInIds.delete(id);
    saveDeletedBuiltInIds();

    const original = ITEMS.find(i => i.id === id);
    if (original && !ITEMS_CONFIG.some(c => c.key === id)) {
        ITEMS_CONFIG.push({ key: id, label: original.name });
    }
    return true;
}

/** @returns {object[]} the shipped (items.json) versions of every currently soft-deleted built-in item — used by Tryb Edycji's small "Usunięte przedmioty" recovery list. */
export function getDeletedBuiltInItems() {
    return ITEMS.filter(i => deletedBuiltInIds.has(i.id));
}

/** @returns {object[]} every item currently known to the game — built-in (items.json, with any overrides applied, minus soft-deleted ones) + custom (Tryb Edycji). */
export function getAllItems() {
    const builtIns = ITEMS
        .filter(i => !deletedBuiltInIds.has(i.id))
        .map(i => itemOverrides[i.id] || i);
    return [...builtIns, ...customItems];
}

export function getItemById(id) {
    if (deletedBuiltInIds.has(id)) return null;
    if (itemOverrides[id]) return itemOverrides[id];
    return ITEMS.find(i => i.id === id) || customItems.find(i => i.id === id) || null;
}

/**
 * Stores a new custom item (already shaped by itemEditor.js /
 * itemSchema.js's makeDefaultItem). Auto-generates an id if none was
 * supplied, and refuses (throwing) if the given/generated id
 * collides with an existing built-in or custom item.
 *
 * Also pushes a {key,label} entry into ITEMS_CONFIG in place, so the
 * perk editor's "Przyznaj Przedmiot" dropdown offers the new item
 * immediately without a page reload.
 *
 * @param {object} item
 * @returns {object} the stored item (with its final id)
 */
export function addCustomItem(item) {
    const id = item.id && String(item.id).trim()
        ? String(item.id).trim()
        : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (getItemById(id)) {
        throw new Error(`Identyfikator przedmiotu "${id}" jest już zajęty.`);
    }

    const stored = { ...item, id };
    customItems.push(stored);
    saveCustomItems();
    ITEMS_CONFIG.push({ key: id, label: stored.name || id });
    return stored;
}

/**
 * Overwrites an existing custom item in place (id is kept fixed —
 * pass it in `item` too, or it'll be re-added). Throws if `id`
 * doesn't belong to a custom item (built-in items.json items go
 * through updateBuiltInItem() instead — see above). Also keeps
 * ITEMS_CONFIG's label in sync in case the name changed.
 * @param {string} id
 * @param {object} item
 * @returns {object} the stored item
 */
export function updateCustomItem(id, item) {
    const idx = customItems.findIndex(i => i.id === id);
    if (idx === -1) {
        throw new Error(`Nie znaleziono własnego przedmiotu o identyfikatorze "${id}" — być może jest to przedmiot wbudowany (użyj updateBuiltInItem()).`);
    }
    const stored = { ...item, id };
    customItems[idx] = stored;
    saveCustomItems();
    const cfgEntry = ITEMS_CONFIG.find(c => c.key === id);
    if (cfgEntry) cfgEntry.label = stored.name || id;
    return stored;
}

/** Removes a custom item by id (no-op, returning false, for built-in items.json items — those aren't removable here). */
export function removeCustomItem(id) {
    const before = customItems.length;
    customItems = customItems.filter(i => i.id !== id);
    if (customItems.length === before) return false;
    saveCustomItems();
    const idx = ITEMS_CONFIG.findIndex(c => c.key === id);
    if (idx !== -1) ITEMS_CONFIG.splice(idx, 1);
    return true;
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

/** @returns {{id,name,desc,price,category,quantity}[]} every item currently owned (quantity > 0), built-in or custom. */
export function getOwnedItems() {
    return Object.entries(EquipmentState.inventory)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({
            ...(getItemById(id) || { id, name: id, desc: '(przedmiot usunięty z bazy danych)', price: 0, category: '?' }),
            quantity: qty,
        }));
}

/**
 * Spends `item.price` (in Nitki Konstancjum) from currency and adds
 * one copy of it to the inventory. Used by the Equipment tab's "Kup"
 * (buy) button in market mode. Refuses — returning false — if the
 * item is marked "Nie Sprzedawany" (NOT_FOR_SALE) or the balance
 * can't cover it. A Not-for-Sale item is still obtainable through
 * every other channel (perk grants, splitting a set, …) — this only
 * blocks the market purchase path.
 */
export function buyItem(itemId) {
    const item = getItemById(itemId);
    if (!item) return false;
    if (isNotForSale(item.price)) return false;
    if (EquipmentState.currency < item.price) return false;
    addCurrency(-item.price);
    addItemQuantity(itemId, 1);
    return true;
}


// ------------------------------------------------------------
// SETS — assembling from components / splitting into components
// ------------------------------------------------------------
// An item marked `isSet` decomposes into `setMembers`: a list of
// { itemId, quantity } entries — the same component item can appear
// with any quantity > 1, so a set can require e.g. two of the same
// arrow rather than only ever one of each distinct piece.
//
// Older data (or a set built before this feature) may still store
// setMembers as a plain array of id strings (implicitly quantity 1
// each) — normalizeSetMembers() reads either shape transparently, so
// nothing already saved needs migrating by hand.

/**
 * Normalizes a set's `setMembers` into a consistent
 * {itemId, quantity}[] shape, accepting either the current shape or
 * the older plain-id-string shape (implicitly quantity 1).
 * @param {(string|{itemId:string,quantity:number})[]} setMembers
 * @returns {{itemId:string, quantity:number}[]}
 */
export function normalizeSetMembers(setMembers) {
    if (!Array.isArray(setMembers)) return [];
    return setMembers.map(m => (typeof m === 'string')
        ? { itemId: m, quantity: 1 }
        : { itemId: m.itemId, quantity: Math.max(1, Number(m.quantity) || 1) });
}

/**
 * @param {string} itemId — must be a set item (isSet: true)
 * @returns {boolean} true if the player currently owns enough of
 *   every component to assemble one copy of this set right now.
 */
export function canAssembleSet(itemId) {
    const item = getItemById(itemId);
    if (!item || !item.isSet) return false;
    const members = normalizeSetMembers(item.setMembers);
    if (members.length === 0) return false;
    return members.every(m => getItemQuantity(m.itemId) >= m.quantity);
}

/**
 * Consumes each component (in its configured quantity) from the
 * inventory and grants one copy of the set item in exchange. Refuses
 * — returning false, changing nothing — if any component is short
 * (see canAssembleSet()).
 * @param {string} itemId
 * @returns {boolean}
 */
export function assembleSet(itemId) {
    if (!canAssembleSet(itemId)) return false;
    const item = getItemById(itemId);
    const members = normalizeSetMembers(item.setMembers);
    for (const m of members) addItemQuantity(m.itemId, -m.quantity);
    addItemQuantity(itemId, 1);
    return true;
}

/**
 * Consumes one copy of a set item and grants each of its components
 * back into the inventory, in their configured quantity. Refuses —
 * returning false, changing nothing — if the player doesn't own at
 * least one copy of the set, or it isn't a set / has no components.
 * @param {string} itemId
 * @returns {boolean}
 */
export function splitSet(itemId) {
    const item = getItemById(itemId);
    if (!item || !item.isSet) return false;
    if (getItemQuantity(itemId) <= 0) return false;
    const members = normalizeSetMembers(item.setMembers);
    if (members.length === 0) return false;
    addItemQuantity(itemId, -1);
    for (const m of members) addItemQuantity(m.itemId, m.quantity);
    return true;
}
