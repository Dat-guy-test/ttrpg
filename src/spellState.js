// ============================================================
// SPELL STATE
//
// Data model + persistence for the Arkana tab's "Wielka Księga
// Zaklęć" (spell compendium) and "Znane zaklęcia" (known spells).
// Mirrors equipmentState.js's structure almost exactly:
//   - spells.json's `SPELLS` array is read-only built-in data.
//   - Player-created spells (Magic Editor) live in their own
//     localStorage key, merged with the built-ins at read time.
//   - Editing an EXISTING built-in spell stores an "override" copy
//     rather than mutating spells.json.
//   - "Deleting" a built-in spell soft-hides it instead.
//
// KNOWN SPELLS
// ------------------------------------------------------------
// A perk can grant either:
//   - a specific spell (EFFECT_TYPES' 'spellUnlock')      → tracked
//     in `knownSpellSources`: { [sourceId]: spellId }
//   - access to any compendium spell matching one or more schools
//     up to a max complexity (EFFECT_TYPES' 'spellSchoolUnlock') →
//     tracked in `schoolGrantSources`: { [sourceId]: {schools, maxComplexity} }
// getKnownSpells() resolves both into the actual list of spells the
// character currently knows. Like currency/items, this is routed
// through perkEffects.js's small explicit branches rather than the
// generic setPerkModifier() machinery, since "known or not" isn't a
// number that adds up.
//
// This module deliberately imports nothing from characterState.js
// (same reasoning as equipmentState.js) so characterState.js can
// import SPELLS_CONFIG from here without creating a cycle.
// ============================================================

import spellsData from './spells.json';

export const SPELLS = Array.isArray(spellsData)
    ? spellsData
    : (Array.isArray(spellsData?.spells) ? spellsData.spells : []);

if (!Array.isArray(spellsData) && !Array.isArray(spellsData?.spells)) {
    console.error('SpellState: spells.json is neither a bare array nor a { spells: [...] } object — treating it as empty.');
}

// Mutable in place (never reassigned) — characterState.js's
// EFFECT_TYPES 'spellUnlock' entry holds a direct reference to this
// exact array as its `options` list, mirroring ITEMS_CONFIG.
export const SPELLS_CONFIG = SPELLS.map(s => ({ key: s.id, label: s.name }));

const CUSTOM_SPELLS_STORAGE_KEY   = 'ttrpgCustomSpells.v1';
const SPELL_OVERRIDES_STORAGE_KEY = 'ttrpgSpellOverrides.v1';
const SPELL_DELETIONS_STORAGE_KEY = 'ttrpgDeletedBuiltInSpells.v1';
const KNOWN_SPELLS_STORAGE_KEY    = 'ttrpgKnownSpells.v1';
const SCHOOL_GRANTS_STORAGE_KEY   = 'ttrpgSpellSchoolGrants.v1';

// ------------------------------------------------------------
// CUSTOM SPELLS
// ------------------------------------------------------------

function loadCustomSpells() {
    try {
        const raw = localStorage.getItem(CUSTOM_SPELLS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('SpellState: failed to load custom spells — starting fresh.', e);
        return [];
    }
}

let customSpells = loadCustomSpells();

function saveCustomSpells() {
    try {
        localStorage.setItem(CUSTOM_SPELLS_STORAGE_KEY, JSON.stringify(customSpells));
    } catch (e) {
        console.error('SpellState: failed to save custom spells.', e);
    }
}

// Same "drop it if it's since been merged into the built-in file"
// pruning as equipmentState.js's pruneMergedCustomItems().
(function pruneMergedCustomSpells() {
    const before = customSpells.length;
    customSpells = customSpells.filter(s => !SPELLS.some(b => b.id === s.id));
    if (customSpells.length !== before) saveCustomSpells();
})();

for (const spell of customSpells) {
    if (!SPELLS_CONFIG.some(c => c.key === spell.id)) {
        SPELLS_CONFIG.push({ key: spell.id, label: spell.name });
    }
}

export function getCustomSpells() {
    return customSpells;
}

// ------------------------------------------------------------
// BUILT-IN SPELL OVERRIDES  (editing an EXISTING spells.json spell)
// ------------------------------------------------------------

function loadSpellOverrides() {
    try {
        const raw = localStorage.getItem(SPELL_OVERRIDES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        console.error('SpellState: failed to load built-in spell overrides — starting fresh.', e);
        return {};
    }
}

let spellOverrides = loadSpellOverrides();

function saveSpellOverrides() {
    try {
        localStorage.setItem(SPELL_OVERRIDES_STORAGE_KEY, JSON.stringify(spellOverrides));
    } catch (e) {
        console.error('SpellState: failed to save built-in spell overrides.', e);
    }
}

(function pruneOrphanedSpellOverrides() {
    const before = Object.keys(spellOverrides).length;
    for (const id of Object.keys(spellOverrides)) {
        if (!SPELLS.some(s => s.id === id)) delete spellOverrides[id];
    }
    if (Object.keys(spellOverrides).length !== before) saveSpellOverrides();
})();

export function isBuiltInSpellId(id) {
    return SPELLS.some(s => s.id === id);
}

export function hasBuiltInOverride(id) {
    return Object.prototype.hasOwnProperty.call(spellOverrides, id);
}

export function updateBuiltInSpell(id, spell) {
    if (!SPELLS.some(s => s.id === id)) {
        throw new Error(`"${id}" nie jest zaklęciem wbudowanym — nie można nadpisać.`);
    }
    const stored = { ...spell, id };
    spellOverrides[id] = stored;
    saveSpellOverrides();
    return stored;
}

export function resetBuiltInSpellOverride(id) {
    if (!Object.prototype.hasOwnProperty.call(spellOverrides, id)) return false;
    delete spellOverrides[id];
    saveSpellOverrides();
    return true;
}

// ------------------------------------------------------------
// BUILT-IN SPELL DELETIONS  ("deleting" a spells.json spell)
// ------------------------------------------------------------

function loadDeletedBuiltInIds() {
    try {
        const raw = localStorage.getItem(SPELL_DELETIONS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
        console.error('SpellState: failed to load deleted built-in spells — starting fresh.', e);
        return new Set();
    }
}

let deletedBuiltInIds = loadDeletedBuiltInIds();

function saveDeletedBuiltInIds() {
    try {
        localStorage.setItem(SPELL_DELETIONS_STORAGE_KEY, JSON.stringify([...deletedBuiltInIds]));
    } catch (e) {
        console.error('SpellState: failed to save deleted built-in spells.', e);
    }
}

(function pruneStaleDeletions() {
    const before = deletedBuiltInIds.size;
    for (const id of deletedBuiltInIds) {
        if (!SPELLS.some(s => s.id === id)) deletedBuiltInIds.delete(id);
    }
    if (deletedBuiltInIds.size !== before) saveDeletedBuiltInIds();
})();

export function isBuiltInSpellDeleted(id) {
    return deletedBuiltInIds.has(id);
}

export function deleteBuiltInSpell(id) {
    if (!SPELLS.some(s => s.id === id)) {
        throw new Error(`"${id}" nie jest zaklęciem wbudowanym — nie można go usunąć w ten sposób.`);
    }
    deletedBuiltInIds.add(id);
    saveDeletedBuiltInIds();

    if (Object.prototype.hasOwnProperty.call(spellOverrides, id)) {
        delete spellOverrides[id];
        saveSpellOverrides();
    }
    const idx = SPELLS_CONFIG.findIndex(c => c.key === id);
    if (idx !== -1) SPELLS_CONFIG.splice(idx, 1);
    return true;
}

export function restoreBuiltInSpell(id) {
    if (!deletedBuiltInIds.has(id)) return false;
    deletedBuiltInIds.delete(id);
    saveDeletedBuiltInIds();

    const original = SPELLS.find(s => s.id === id);
    if (original && !SPELLS_CONFIG.some(c => c.key === id)) {
        SPELLS_CONFIG.push({ key: id, label: original.name });
    }
    return true;
}

export function getDeletedBuiltInSpells() {
    return SPELLS.filter(s => deletedBuiltInIds.has(s.id));
}

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

/** @returns {object[]} every spell currently known to the game — built-in (with overrides applied, minus soft-deleted) + custom. */
export function getAllSpells() {
    const builtIns = SPELLS
        .filter(s => !deletedBuiltInIds.has(s.id))
        .map(s => spellOverrides[s.id] || s);
    return [...builtIns, ...customSpells];
}

export function getSpellById(id) {
    if (deletedBuiltInIds.has(id)) return null;
    if (spellOverrides[id]) return spellOverrides[id];
    return SPELLS.find(s => s.id === id) || customSpells.find(s => s.id === id) || null;
}

/**
 * @param {object} spell
 * @returns {object} the stored spell (with its final id)
 */
export function addCustomSpell(spell) {
    const id = spell.id && String(spell.id).trim()
        ? String(spell.id).trim()
        : `custom-spell-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (getSpellById(id)) {
        throw new Error(`Identyfikator zaklęcia "${id}" jest już zajęty.`);
    }

    const stored = { ...spell, id };
    customSpells.push(stored);
    saveCustomSpells();
    SPELLS_CONFIG.push({ key: id, label: stored.name || id });
    return stored;
}

export function updateCustomSpell(id, spell) {
    const idx = customSpells.findIndex(s => s.id === id);
    if (idx === -1) {
        throw new Error(`Nie znaleziono własnego zaklęcia o identyfikatorze "${id}" — być może jest to zaklęcie wbudowane (użyj updateBuiltInSpell()).`);
    }
    const stored = { ...spell, id };
    customSpells[idx] = stored;
    saveCustomSpells();
    const cfgEntry = SPELLS_CONFIG.find(c => c.key === id);
    if (cfgEntry) cfgEntry.label = stored.name || id;
    return stored;
}

export function removeCustomSpell(id) {
    const before = customSpells.length;
    customSpells = customSpells.filter(s => s.id !== id);
    if (customSpells.length === before) return false;
    saveCustomSpells();
    const idx = SPELLS_CONFIG.findIndex(c => c.key === id);
    if (idx !== -1) SPELLS_CONFIG.splice(idx, 1);
    return true;
}

// ------------------------------------------------------------
// KNOWN SPELLS  (perk-granted access)
// ------------------------------------------------------------

function loadKnownSpellSources() {
    try {
        const raw = localStorage.getItem(KNOWN_SPELLS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        console.error('SpellState: failed to load known spells — starting fresh.', e);
        return {};
    }
}

let knownSpellSources = loadKnownSpellSources(); // { [sourceId]: spellId }

function saveKnownSpellSources() {
    try {
        localStorage.setItem(KNOWN_SPELLS_STORAGE_KEY, JSON.stringify(knownSpellSources));
    } catch (e) {
        console.error('SpellState: failed to save known spells.', e);
    }
}

function loadSchoolGrantSources() {
    try {
        const raw = localStorage.getItem(SCHOOL_GRANTS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        console.error('SpellState: failed to load spell school grants — starting fresh.', e);
        return {};
    }
}

let schoolGrantSources = loadSchoolGrantSources(); // { [sourceId]: {schools:string[], maxComplexity:number} }

function saveSchoolGrantSources() {
    try {
        localStorage.setItem(SCHOOL_GRANTS_STORAGE_KEY, JSON.stringify(schoolGrantSources));
    } catch (e) {
        console.error('SpellState: failed to save spell school grants.', e);
    }
}

/** Grants (or updates) one perk's specific-spell unlock. Called on node activation. */
export function addKnownSpell(sourceId, spellId) {
    knownSpellSources[sourceId] = spellId;
    saveKnownSpellSources();
}

/** Revokes one perk's specific-spell unlock. Called on node deactivation. */
export function removeKnownSpell(sourceId) {
    if (!(sourceId in knownSpellSources)) return;
    delete knownSpellSources[sourceId];
    saveKnownSpellSources();
}

/** Grants (or updates) one perk's school-based unlock. */
export function addSpellSchoolGrant(sourceId, schools, maxComplexity) {
    schoolGrantSources[sourceId] = { schools: [...schools], maxComplexity: Number(maxComplexity) || 0 };
    saveSchoolGrantSources();
}

/** Revokes one perk's school-based unlock. */
export function removeSpellSchoolGrant(sourceId) {
    if (!(sourceId in schoolGrantSources)) return;
    delete schoolGrantSources[sourceId];
    saveSchoolGrantSources();
}

/** @returns {{schools:string[], maxComplexity:number}[]} every currently-active school-based grant — used to explain WHY a spell shows up as known. */
export function getSchoolGrants() {
    return Object.values(schoolGrantSources);
}

/**
 * Resolves every currently-known spell: specific perk-granted spells
 * PLUS every compendium spell matching an active school grant
 * (shares at least one school with the grant, and complexity <= the
 * grant's maxComplexity). Deduplicated by id.
 * @returns {object[]}
 */
export function getKnownSpells() {
    const known = new Map();

    for (const spellId of Object.values(knownSpellSources)) {
        const spell = getSpellById(spellId);
        if (spell) known.set(spell.id, spell);
    }

    const grants = getSchoolGrants();
    if (grants.length > 0) {
        for (const spell of getAllSpells()) {
            if (known.has(spell.id)) continue;
            const spellSchools = Array.isArray(spell.schools) ? spell.schools : [];
            const matches = grants.some(g =>
                g.schools.some(s => spellSchools.includes(s)) &&
                (Number(spell.complexity) || 0) <= g.maxComplexity
            );
            if (matches) known.set(spell.id, spell);
        }
    }

    return [...known.values()];
}

export function resetSpellProgressState() {
    knownSpellSources = {};
    schoolGrantSources = {};
    saveKnownSpellSources();
    saveSchoolGrantSources();
}
