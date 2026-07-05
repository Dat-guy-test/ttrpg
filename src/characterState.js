// ============================================================
// CHARACTER STATE
//
// Data model + persistence for the Character Data tab.
// Same pattern as appState.js: one mutable singleton object,
// imported and written to directly by whatever module needs it.
//
// ------------------------------------------------------------
// PERK-ONLY STAT FIELDS
// ------------------------------------------------------------
// Charakterystyki, both halves of every Umiejętność (Doświadczenie
// + Improwizacja), and every Wprawa entry are NOT editable on the
// sheet — they only change through the perk tree. Each is stored as:
//
//   { base: number, modifiers: [{ sourceId, amount, label }] }
//
// `base` is a code-level starting value (0 unless you set one
// elsewhere, e.g. a future character-creation flow) — there is no
// UI for editing it. `modifiers` is populated by perkEffects.js
// when a tree node with an `effect` is activated/deactivated.
// computeStatValue() sums base + modifiers for display.
//
// Fields are addressed by dot-path string (e.g.
// 'abilities.sila.experience', 'resources.actionPoints.max') so
// setPerkModifier() / clearPerkModifiers() work generically across
// every perk-driven NUMERIC field without special-casing each group.
//
// Resource Maxima (Punkty Akcji/Energii, Wytrzymałość) are NOT
// separate perk-driven fields at all — they're read directly off a
// linked Charakterystyka (see RESOURCE_MAX_SOURCES below), so they
// automatically track whatever perks grant that Charakterystyka.
//
// Wprawa (proficiencies) differs from the other perk-only fields in
// that its keys are NOT a fixed config list — a perk effect can
// grant a level in any named Wprawa via free text, so entries are
// created on demand the first time a perk targets that name (see
// setPerkModifier()'s 'proficiency:' special-case below).
//
// Atrybuty (attributes) are NOT numeric at all — a perk grants a
// named trait plus a free-text description, and the trait is either
// present or it isn't (no amount to add up). Because of that they
// don't go through setPerkModifier()/computeStatValue() like
// everything above; they have their own tiny source-tracked store —
// see the ATRYBUTY section and setAttributeSource()/
// clearAttributeSource() further down.
//
// Currency and Items (equipmentState.js) are ALSO not numeric fields
// here — they live in their own module entirely, with their own
// storage key, because unlike every stat above they're meant to be
// directly spent/traded by the player rather than only tracked as
// "base + perk modifiers". 'currency' and 'item' EFFECT_TYPES below
// are routed to equipmentState.js by perkEffects.js's small explicit
// branch, same pattern as 'attribute'.
// ============================================================

const STORAGE_KEY = 'ttrpgCharacterSheet.v2'; // bumped: v1 sheets had editable base stats

import { ITEMS_CONFIG } from './equipmentState.js';

// ---- Static config: edit these arrays to add/rename/reorder fields ----

export const CHARACTERISTICS_CONFIG = [
    { key: 'forma',    label: 'Forma' },
    { key: 'bystrosc', label: 'Bystrość' },
    { key: 'silaWoli', label: 'Siła Woli' },
    { key: 'szybkosc', label: 'Szybkość' },
    { key: 'udzwig',   label: 'Udźwig' },
];

export const ABILITIES_CONFIG = [
    { key: 'sila',              label: 'Siła' },
    { key: 'wigor',              label: 'Wigor' },
    { key: 'czasReakcji',        label: 'Czas Reakcji' },
    { key: 'determinacja',       label: 'Determinacja' },
    { key: 'charyzma',           label: 'Charyzma' },
    { key: 'skradanieSie',       label: 'Skradanie się' },
    { key: 'zrecznosc',          label: 'Zręczność' },
    { key: 'spostrzegawczosc',   label: 'Spostrzegawczość' },
    { key: 'instynkt',           label: 'Instynkt' },
    { key: 'wiedzaMedyczna',     label: 'Wiedza Medyczna' },
    { key: 'alchemia',           label: 'Alchemia' },
    { key: 'majsterkowanie',     label: 'Majsterkowanie' },
    { key: 'zaklinanie',         label: 'Zaklinanie' },
    { key: 'badawczosc',         label: 'Badawczość' },
    { key: 'wiedzaPowszechna',   label: 'Wiedza Powszechna' },
    { key: 'wiedzaMagiczna',     label: 'Wiedza Tajemna' },
    { key: 'wykuwanieZaklec',    label: 'Wykuwanie Zaklęć' },
    { key: 'kreacja',            label: 'Kreacja' },
    { key: 'projekcja',          label: 'Projekcja' },
    { key: 'transmutacja',       label: 'Transmutacja' },
    { key: 'przywolywanie',      label: 'Przywoływanie' },
    { key: 'destrukcja',         label: 'Destrukcja' },
];

// Rows 2-7 (critical: true) get highlighted; "Zwyk." (critical: false)
// does not. "Łącznie" is a single computed field, handled separately.
export const DAMAGE_ROWS_CONFIG = [
    { key: 'rany',        label: 'Rany',   critical: true  },
    { key: 'zlamania',    label: 'Złam.',  critical: true  },
    { key: 'wewnetrzne',  label: 'Wewn.',  critical: true  },
    { key: 'temperatura', label: 'Temp.',  critical: true  },
    { key: 'choroby',     label: 'Chor.',  critical: true  },
    { key: 'krytyczne',   label: 'Kryt.',  critical: true  },
    { key: 'zwykle',      label: 'Zwyk.',  critical: false },
];


// Improvisation is a 1-6 level; level 0 means "no die yet". Also
// reused as-is for Wprawa levels (see refreshProficiency effect type
// below) — same dice progression, just keyed by free text instead of
// a fixed ability list.
export const IMPROVISATION_DICE = ['—', '+1d4', '+1d6', '+1d8', '+1d10', '+1d12', '+1d20'];

/** @param {number} level @returns {string} e.g. "+1d8", or "—" at level 0 */
export function formatImprovisation(level) {
    const clamped = Math.max(0, Math.min(6, Math.round(Number(level) || 0)));
    return IMPROVISATION_DICE[clamped];
}

// ------------------------------------------------------------
// RESOURCE MAXIMA — linked Charakterystyki
// ------------------------------------------------------------
// Each resource's Maximum isn't its own perk-driven field — it's
// just whatever the linked Charakterystyka currently computes to
// (base + perk modifiers). This means perks never need to target
// resource maxima directly; boosting the linked Charakterystyka is
// enough, and it's impossible for the two to drift out of sync.
export const RESOURCE_MAX_SOURCES = {
    actionPoints: 'bystrosc',
    energyPoints: 'silaWoli',
    endurance:    'forma',
};

/**
 * @param {string} resourceKey — 'actionPoints' | 'energyPoints' | 'endurance'
 * @returns {{ value:number, isModified:boolean, modifiers:object[] }}
 */
export function computeResourceMax(resourceKey) {
    const charKey = RESOURCE_MAX_SOURCES[resourceKey];
    const field = charKey ? CharacterState.characteristics[charKey] : null;
    return computeStatValue(field);
}

// ------------------------------------------------------------
// POTENCJAŁ (perk-point budget)
// ------------------------------------------------------------
// `potential.total` is the ONLY player-editable half of this pair —
// it's the max number of perk points the tree can spend, with a
// hard floor of MIN_POTENTIAL (a fresh/blank character always starts
// with at least that many). `potential.available` is never stored;
// it's always derived as total - spent, where "spent" is the sum of
// nodeCost across every currently-active tree node — CharacterState
// .perksTaken already carries each active node's cost (see
// perkEffects.js's refreshPerksTaken()), so no separate tracking is
// needed. setPotentialTotal() is the only way to change `total` and
// refuses to drop it below whatever's already spent.
export const MIN_POTENTIAL = 20;

// ------------------------------------------------------------
// POINT POOLS
// ------------------------------------------------------------
// A perk can grant a lump of points instead of (or alongside) a fixed
// stat bump. The player then spends those points themselves, one at a
// time, via +/- buttons next to the eligible stats. Each pool tracks:
//   - granted: a perk-only {base, modifiers} field, same as any other
//     perk-driven stat — perks add to it via setPerkModifier().
//   - spent:   NOT stored directly; it's derived by summing the
//     player's own allocation modifiers (sourceId 'pool:<poolKey>')
//     across every field the pool is allowed to target. See
//     computePoolSpent()/adjustPoolAllocation() below.
//
// `targetKind` says which computeStatValue-shaped fields the pool may
// be spent on; `allowedCharacteristics` narrows that further for the
// 'characteristic' kind (only some characteristics are spendable).
export const POINT_POOLS_CONFIG = [
    {
        key: 'characteristicPoints',
        label: 'Punkty Charakterystyki',
        targetKind: 'characteristic',
        allowedCharacteristics: ['forma', 'bystrosc', 'silaWoli'],
    },
    {
        key: 'skillExperiencePoints',
        label: 'Punkty Doświadczenia',
        targetKind: 'skillExperience', // spendable on any ability's Doświadczenie
    },
    {
        key: 'skillImprovisationPoints',
        label: 'Punkty Improwizacji',
        targetKind: 'skillImprovisation', // spendable on any ability's Improwizacja
    },
];

// ------------------------------------------------------------
// EFFECT TYPES
// ------------------------------------------------------------
// Single source of truth for what a tree node's `effects` entries can
// target. Used by editMode.js to build the inspector's effect form,
// and by perkEffects.js to resolve/apply the actual effect. Add a new
// entry here to make a new kind of perk effect available in the
// editor — nothing else needs to change (with the caveat that a
// wholly non-numeric effect — like 'attribute', 'currency', or
// 'item' — needs a small explicit branch in perkEffects.js's
// applyNodeEffect/removeNodeEffect, since setPerkModifier() only
// understands numeric {base,modifiers} fields).
//
// Per-entry flags editMode.js's effect form reads:
//   needsKey         (default true)  — false for "grant points to a
//                     pool" effects; there's only one pool of each
//                     kind so no target picker is shown. Also false
//                     for 'currency' — there's only one currency.
//   freeform         (default false) — target ISN'T one of a fixed
//                     `options` list; the editor shows a text input
//                     instead of a dropdown, and the field springs
//                     into existence the first time something uses
//                     that name (Wprawa, Atrybuty).
//   needsAmount      (default true)  — false for effects with no
//                     numeric magnitude (currently just 'attribute');
//                     the editor hides the Amount input and the
//                     effect object simply omits `amount`.
//   needsDescription (default false) — true for effects that carry a
//                     free-text description alongside their name
//                     (currently just 'attribute'); the editor shows
//                     an extra textarea and the effect object carries
//                     a `description` string.
export const EFFECT_TYPES = [
    {
        value: 'characteristic',
        label: 'Zwiększ Charakterystykę (stała wartość)',
        options: CHARACTERISTICS_CONFIG,
        needsKey: true,
        fieldPath: (key) => `characteristics.${key}`,
    },
    {
        value: 'skillExperience',
        label: 'Zwiększ Doświadczenie Umiejętności (stała wartość)',
        options: ABILITIES_CONFIG,
        needsKey: true,
        fieldPath: (key) => `abilities.${key}.experience`,
    },
    {
        value: 'skillImprovisation',
        label: 'Zwiększ Poziom Improwizacji (stała wartość)',
        options: ABILITIES_CONFIG,
        needsKey: true,
        fieldPath: (key) => `abilities.${key}.improvisation`,
    },
    {
        value: 'proficiency',
        label: 'Zwiększ Poziom Wprawy (dowolna nazwa)',
        options: [],
        needsKey: true,
        freeform: true, // editor shows a text input for the target instead of a dropdown
        fieldPath: (key) => `proficiency:${key}`,
    },
    {
        value: 'attribute',
        label: 'Nadaj Atrybut (nazwa + opis)',
        options: [],
        needsKey: true,
        freeform: true,        // editor shows a text input for the name instead of a dropdown
        needsAmount: false,    // attributes are present-or-not, not additive
        needsDescription: true, // editor shows an extra description textarea
        // Not used by setPerkModifier() — attributes are non-numeric and are
        // routed to setAttributeSource()/clearAttributeSource() instead; see
        // perkEffects.js's applyNodeEffect()/removeNodeEffect(). Kept here
        // only so every EFFECT_TYPES entry has a fieldPath for consistency.
        fieldPath: (key) => `attribute:${key}`,
    },
    {
        value: 'characteristicPoints',
        label: 'Przyznaj Punkty Charakterystyki (Forma / Bystrość / Siła Woli)',
        options: [],
        needsKey: false,
        fieldPath: () => 'pointPools.characteristicPoints.granted',
    },
    {
        value: 'skillExperiencePoints',
        label: 'Przyznaj Punkty Doświadczenia (dowolna Umiejętność)',
        options: [],
        needsKey: false,
        fieldPath: () => 'pointPools.skillExperiencePoints.granted',
    },
    {
        value: 'skillImprovisationPoints',
        label: 'Przyznaj Punkty Improwizacji (dowolna Umiejętność)',
        options: [],
        needsKey: false,
        fieldPath: () => 'pointPools.skillImprovisationPoints.granted',
    },
    {
        value: 'currency',
        label: 'Przyznaj Walutę (Pierścienie)',
        options: [],
        needsKey: false,
        // Not used by setPerkModifier() — routed to equipmentState.js's
        // addCurrency() instead; see perkEffects.js. Kept for consistency
        // with every other EFFECT_TYPES entry having a fieldPath.
        fieldPath: () => 'equipment:currency',
    },
    {
        value: 'item',
        label: 'Przyznaj Przedmiot',
        options: ITEMS_CONFIG,
        needsKey: true,
        // Not used by setPerkModifier() — routed to equipmentState.js's
        // addItemQuantity() instead; see perkEffects.js.
        fieldPath: (key) => `equipment:item:${key}`,
    },
];


// ---- Helpers to build default shapes -----------------------------------

function makeStatField(base = 0) {
    return { base, modifiers: [] };
}

function buildDefaultState() {
    const characteristics = {};
    for (const c of CHARACTERISTICS_CONFIG) characteristics[c.key] = makeStatField(0);

    const abilities = {};
    for (const a of ABILITIES_CONFIG) {
        abilities[a.key] = {
            experience:    makeStatField(0),
            improvisation: makeStatField(1), // level 1 = +1d4, see IMPROVISATION_DICE
        };
    }

    const damage = {};
    for (const d of DAMAGE_ROWS_CONFIG) damage[d.key] = { nZal: 0, zal: 0 };

    const pointPools = {};
    for (const p of POINT_POOLS_CONFIG) pointPools[p.key] = { granted: makeStatField(0) };

    return {
        name: '',
        potential:  { total: MIN_POTENTIAL }, // 'available' is derived, never stored — see computePotentialAvailable()
        resources: {
            // No 'max' fields here — resource maxima are read live off a
            // linked Charakterystyka, see RESOURCE_MAX_SOURCES/computeResourceMax().
            actionPoints: { current: 0 },
            energyPoints: { current: 0 },
            endurance:    {},
        },
        damage,                 // { [rowKey]: { nZal, zal } } — freely editable
        characteristics,         // { [key]: { base, modifiers } } — perk-only
        abilities,                 // { [key]: { experience, improvisation } } — perk-only
        pointPools,                 // { [poolKey]: { granted: {base, modifiers} } } — perk-only totals; spend via adjustPoolAllocation()
        proficiencies: {},               // { [name]: { base, modifiers } } — perk-only; keys created on demand, see EFFECT_TYPES's 'proficiency' entry
        attributes: {},                     // { [name]: { description, sources: {[sourceId]: description} } } — perk-only; see ATRYBUTY section below
        perksTaken: [],                 // [{ id, name, cost }] — derived live from active tree nodes, see perkEffects.js
    };
}

/**
 * Merges a saved sheet on top of a fresh default shape. Only restores
 * the parts of the sheet a player can actually edit by hand (name,
 * potential.total, resource "current", damage) plus each perk-field's
 * `base`. Modifiers are never restored from storage — they're derived
 * from which tree nodes are currently active, and re-applied live by
 * perkEffects.js as the player (re)activates nodes each session.
 * `perksTaken`, `proficiencies`, and `attributes` are the same story:
 * rebuilt/created live from whichever nodes are active, so they're
 * deliberately never restored here either — stale data from a
 * previous session would otherwise show perks/Wprawa/Atrybuty the
 * tree doesn't actually grant anymore.
 */
function mergeWithDefaults(defaults, saved) {
    if (!saved || typeof saved !== 'object') return defaults;

    const out = defaults;
    out.name = typeof saved.name === 'string' ? saved.name : out.name;

    if (saved.potential) {
        const total = Number(saved.potential.total);
        if (Number.isFinite(total)) out.potential.total = Math.max(MIN_POTENTIAL, Math.round(total));
    }

    if (saved.resources) {
        for (const key of Object.keys(out.resources)) {
            const savedRes = saved.resources[key];
            if (!savedRes) continue;
            if ('current' in savedRes) out.resources[key].current = Number(savedRes.current) || 0;
        }
    }

    if (saved.damage) {
        for (const key of Object.keys(out.damage)) {
            if (saved.damage[key]) Object.assign(out.damage[key], saved.damage[key]);
        }
    }

    if (saved.characteristics) {
        for (const key of Object.keys(out.characteristics)) {
            const savedField = saved.characteristics[key];
            if (savedField && typeof savedField.base === 'number') out.characteristics[key].base = savedField.base;
        }
    }

    if (saved.abilities) {
        for (const key of Object.keys(out.abilities)) {
            const savedAbility = saved.abilities[key];
            if (!savedAbility) continue;
            if (savedAbility.experience && typeof savedAbility.experience.base === 'number') {
                out.abilities[key].experience.base = savedAbility.experience.base;
            }
            if (savedAbility.improvisation && typeof savedAbility.improvisation.base === 'number') {
                out.abilities[key].improvisation.base = savedAbility.improvisation.base;
            }
        }
    }

    if (saved.pointPools) {
        for (const key of Object.keys(out.pointPools)) {
            const savedPool = saved.pointPools[key];
            if (savedPool && savedPool.granted && typeof savedPool.granted.base === 'number') {
                out.pointPools[key].granted.base = savedPool.granted.base;
            }
        }
    }

    // Player-spent points (modifiers with a 'pool:' sourceId) ARE restored,
    // unlike perk modifiers — spending is a deliberate player choice, not
    // something re-derived from which tree nodes happen to be active.
    restorePoolModifiers(out, saved);

    return out;
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildDefaultState();
        return mergeWithDefaults(buildDefaultState(), JSON.parse(raw));
    } catch (e) {
        console.error('CharacterState: failed to load saved sheet — starting fresh.', e);
        return buildDefaultState();
    }
}

export const CharacterState = load();

export function saveCharacterState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(CharacterState));
    } catch (e) {
        console.error('CharacterState: failed to save.', e);
    }
}

export function resetCharacterState() {
    Object.assign(CharacterState, buildDefaultState());
    saveCharacterState();
}


// ---- Computed values -----------------------------------------------------

/**
 * @param {{base:number, modifiers:{sourceId:string,amount:number,label:string}[]}} field
 * @returns {{ value:number, isModified:boolean, modifiers:object[] }}
 */
export function computeStatValue(field) {
    if (!field) return { value: 0, isModified: false, modifiers: [] };
    const value = field.modifiers.reduce((sum, m) => sum + Number(m.amount || 0), Number(field.base) || 0);
    return { value, isModified: field.modifiers.length > 0, modifiers: field.modifiers };
}

/** Sums every damage row's two columns into the "Łącznie" total. */
export function computeDamageTotal() {
    let total = 0;
    for (const row of Object.values(CharacterState.damage)) {
        total += Number(row.nZal || 0) + Number(row.zal || 0);
    }
    return total;
}


// ---- Perk-system hooks (called by perkEffects.js) -------------------------

function getByPath(path) {
    return path.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), CharacterState);
}

function isStatField(node) {
    return !!node && typeof node === 'object' && Array.isArray(node.modifiers) && 'base' in node;
}

/** Recursively visits every {base, modifiers} field anywhere in CharacterState. */
function walkStatFields(node, cb) {
    if (!node || typeof node !== 'object') return;
    if (isStatField(node)) { cb(node); return; }
    for (const value of Object.values(node)) walkStatFields(value, cb);
}

/**
 * Walks `outNode` (a freshly-built default field tree) alongside
 * `savedNode` (the raw parsed JSON) and copies over only the
 * modifiers whose sourceId starts with 'pool:' — i.e. points the
 * player has actually spent — leaving perk-contributed modifiers
 * (sourceId 'node:...') to be re-derived live from active tree nodes,
 * same as before. Used by mergeWithDefaults() on load.
 */
function restorePoolModifiers(outNode, savedNode) {
    if (!outNode || typeof outNode !== 'object' || !savedNode || typeof savedNode !== 'object') return;
    if (isStatField(outNode)) {
        if (Array.isArray(savedNode.modifiers)) {
            const poolMods = savedNode.modifiers.filter(m => typeof m.sourceId === 'string' && m.sourceId.startsWith('pool:'));
            if (poolMods.length) outNode.modifiers = poolMods.map(m => ({ ...m }));
        }
        return;
    }
    for (const key of Object.keys(outNode)) {
        if (savedNode[key] !== undefined) restorePoolModifiers(outNode[key], savedNode[key]);
    }
}

/**
 * Finds (creating if necessary) the stat field for one named Wprawa
 * entry. Unlike every other perk-only field, Wprawa's key-space isn't
 * a fixed config list — a perk can target any name — so the field
 * has to be able to spring into existence the first time something
 * targets it, instead of being pre-built by buildDefaultState().
 */
function ensureProficiencyField(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    if (!CharacterState.proficiencies[trimmed]) {
        CharacterState.proficiencies[trimmed] = makeStatField(0);
    }
    return CharacterState.proficiencies[trimmed];
}

/**
 * Sets (or clears, if amount is falsy) one perk's contribution to a
 * single perk-ready field, addressed by dot-path — e.g.
 * 'characteristics.forma', 'abilities.sila.experience'. Safe to call
 * repeatedly for the same sourceId — each call replaces that source's
 * previous modifier on this field instead of stacking duplicates.
 *
 * A fieldPath of the form 'proficiency:<name>' is a special case:
 * rather than being looked up (and required to already exist) via
 * getByPath's dot-split, it's resolved/created through
 * ensureProficiencyField() — this is what lets a perk grant Wprawa in
 * an arbitrary, freely-typed name instead of a fixed field.
 *
 * @param {string} fieldPath
 * @param {string} sourceId  — stable id, e.g. `node:${treeNode.nodeId}`
 * @param {number} amount    — modifier amount (may be negative)
 * @param {string} [label]   — human-readable reason, shown in the tooltip
 */
export function setPerkModifier(fieldPath, sourceId, amount, label = '') {
    let field;
    if (fieldPath.startsWith('proficiency:')) {
        field = ensureProficiencyField(fieldPath.slice('proficiency:'.length));
    } else {
        field = getByPath(fieldPath);
    }
    if (!isStatField(field)) {
        console.error(`CharacterState.setPerkModifier: no perk-ready field at "${fieldPath}"`);
        return;
    }
    field.modifiers = field.modifiers.filter(m => m.sourceId !== sourceId);
    if (amount) field.modifiers.push({ sourceId, amount: Number(amount), label });
}

/** Removes every NUMERIC modifier contributed by one source (e.g. one perk node) from every perk-ready field. Does not touch Atrybuty — see clearAttributeSource() for that. */
export function clearPerkModifiers(sourceId) {
    walkStatFields(CharacterState, (field) => {
        field.modifiers = field.modifiers.filter(m => m.sourceId !== sourceId);
    });
}

/** Replaces the "Wybrane Perki" list shown on the sheet. Each entry also carries its nodeCost, so computePerkPointsSpent() can total it. */
export function setPerksTaken(perkList) {
    CharacterState.perksTaken = perkList;
    saveCharacterState();
}

/** Sum of nodeCost across every currently-active tree node (see perksTaken). */
export function computePerkPointsSpent() {
    return CharacterState.perksTaken.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
}

/** "Dostępny Potencjał" — total minus whatever's currently spent. Never stored; always derived. */
export function computePotentialAvailable() {
    return CharacterState.potential.total - computePerkPointsSpent();
}

/**
 * Sets the "Potencjał" (max perk-point budget). Clamped to a floor of
 * MIN_POTENTIAL. Refuses — returning false, leaving the value
 * unchanged — if the new total would be lower than what's already
 * spent (i.e. would make "Dostępny Potencjał" negative).
 *
 * @param {number|string} newTotal
 * @returns {boolean}
 */
export function setPotentialTotal(newTotal) {
    const spent  = computePerkPointsSpent();
    const parsed = Number(newTotal);
    const clamped = Math.max(MIN_POTENTIAL, Math.round(Number.isFinite(parsed) ? parsed : MIN_POTENTIAL));
    if (clamped < spent) return false;
    CharacterState.potential.total = clamped;
    saveCharacterState();
    return true;
}


// ---- Point pools: player spending API --------------------------------

/** Stable modifier source id for points a player has allocated FROM a given pool. */
function poolAllocationSourceId(poolKey) {
    return `pool:${poolKey}`;
}

/** Every field-path a given pool is allowed to spend into. */
function poolTargetFieldPaths(poolKey) {
    const cfg = POINT_POOLS_CONFIG.find(p => p.key === poolKey);
    if (!cfg) return [];
    if (cfg.targetKind === 'characteristic') {
        return cfg.allowedCharacteristics.map(k => `characteristics.${k}`);
    }
    if (cfg.targetKind === 'skillExperience') {
        return ABILITIES_CONFIG.map(a => `abilities.${a.key}.experience`);
    }
    if (cfg.targetKind === 'skillImprovisation') {
        return ABILITIES_CONFIG.map(a => `abilities.${a.key}.improvisation`);
    }
    return [];
}

/** How many points from this pool are currently allocated across all its eligible fields. */
export function computePoolSpent(poolKey) {
    const sourceId = poolAllocationSourceId(poolKey);
    let spent = 0;
    for (const path of poolTargetFieldPaths(poolKey)) {
        const field = getByPath(path);
        const mod = field && field.modifiers.find(m => m.sourceId === sourceId);
        if (mod) spent += Number(mod.amount) || 0;
    }
    return spent;
}

/** granted - spent, for the "available to spend" display. */
export function computePoolAvailable(poolKey) {
    const pool = CharacterState.pointPools[poolKey];
    if (!pool) return 0;
    return computeStatValue(pool.granted).value - computePoolSpent(poolKey);
}

/** How many points from this pool are currently sitting in one specific field (for a field's own -/+ button state). */
export function getFieldPoolAllocation(fieldPath, poolKey) {
    const field = getByPath(fieldPath);
    const mod = field && field.modifiers.find(m => m.sourceId === poolAllocationSourceId(poolKey));
    return mod ? Number(mod.amount) || 0 : 0;
}

/**
 * Spends (delta > 0) or refunds (delta < 0, typically -1) one point
 * from a pool into a specific field. Refuses — returning false,
 * leaving everything unchanged — if that would refund more than was
 * put into this field, spend more than the pool currently has
 * available, or (for Improwizacja) push the field past level 6.
 * Unlike perk modifiers, a successful spend IS persisted immediately.
 *
 * @param {string} poolKey    — e.g. 'characteristicPoints'
 * @param {string} fieldPath  — e.g. 'characteristics.forma'
 * @param {number} delta      — +1 to spend a point, -1 to refund one
 * @returns {boolean}
 */
export function adjustPoolAllocation(poolKey, fieldPath, delta) {
    const poolCfg = POINT_POOLS_CONFIG.find(p => p.key === poolKey);
    const pool    = CharacterState.pointPools[poolKey];
    const field   = getByPath(fieldPath);
    if (!poolCfg || !pool || !isStatField(field)) return false;

    const nextAlloc = getFieldPoolAllocation(fieldPath, poolKey) + delta;
    if (nextAlloc < 0) return false; // can't refund more than was ever put here

    if (delta > 0) {
        const granted = computeStatValue(pool.granted).value;
        if (computePoolSpent(poolKey) + delta > granted) return false; // pool is empty

        if (poolCfg.targetKind === 'skillImprovisation') {
            const { value: currentTotal } = computeStatValue(field);
            if (currentTotal + delta > 6) return false; // dice table tops out at level 6 (+1d20)
        }
    }

    setPerkModifier(fieldPath, poolAllocationSourceId(poolKey), nextAlloc, poolCfg.label);
    saveCharacterState();
    return true;
}


// ------------------------------------------------------------
// ATRYBUTY (attributes)
// ------------------------------------------------------------
// Free-text traits granted by perks — e.g. "Żądza Krwi" with a full
// description paragraph (see nodes.json's Wampir origin for a
// real-world example of this kind of text). Unlike every perk-only
// field above, an Atrybut isn't a number that adds up: it's simply
// present or absent, and its name must stay unique — CharacterState
// .attributes is a plain object keyed by name, so that uniqueness is
// automatic (an object can't have two entries with the same key).
//
// Storage shape:
//   CharacterState.attributes = {
//     [name]: {
//       description: string,             // the text currently shown on the sheet
//       sources: { [sourceId]: string }, // every perk currently granting
//                                        // it, and the description text
//                                        // THAT perk supplied
//     }
//   }
//
// Multiple perks can grant the SAME name — each gets its own entry in
// `sources`, so deactivating one doesn't remove the attribute as long
// as another source still grants it (falls back to that source's
// text instead). The attribute entry itself is only deleted once its
// `sources` dict goes empty. This mirrors the "many modifiers, one
// sourceId per contributor" shape used everywhere else in this file,
// just without the numeric summing.
// ------------------------------------------------------------

/**
 * Finds (creating if necessary) the entry for one named Atrybut.
 * Like Wprawa, an Atrybut's name isn't a fixed config list — any
 * name a perk targets springs into existence the first time it's
 * granted.
 */
function ensureAttributeEntry(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    if (!CharacterState.attributes[trimmed]) {
        CharacterState.attributes[trimmed] = { description: '', sources: {} };
    }
    return CharacterState.attributes[trimmed];
}

/**
 * Grants (or updates) one perk's contribution to a named Atrybut.
 * Safe to call repeatedly for the same sourceId — each call replaces
 * that source's previous text for this name instead of duplicating
 * it. The displayed `description` always reflects whichever source
 * was applied most recently (same "last write for this sourceId
 * wins, but every source keeps its own copy" idea as setPerkModifier,
 * just without the summing).
 *
 * @param {string} name
 * @param {string} sourceId    — e.g. `node:<nodeId>:<effectIndex>`
 * @param {string} description
 */
export function setAttributeSource(name, sourceId, description) {
    const entry = ensureAttributeEntry(name);
    if (!entry) return;
    entry.sources[sourceId] = description || '';
    entry.description = entry.sources[sourceId];
}

/**
 * Removes one source's grant from every Atrybut it contributed to
 * (a single perk node could in principle grant more than one named
 * Atrybut across its effects list, so this checks all of them). If an
 * attribute still has other sources after removing this one, it
 * falls back to showing one of their descriptions instead of going
 * blank; if none remain, the whole attribute entry is deleted —
 * matching clearPerkModifiers()'s "the source's contribution
 * disappears" behaviour for numeric fields.
 *
 * @param {string} sourceId
 */
export function clearAttributeSource(sourceId) {
    for (const name of Object.keys(CharacterState.attributes)) {
        const entry = CharacterState.attributes[name];
        if (!(sourceId in entry.sources)) continue;

        delete entry.sources[sourceId];

        const remaining = Object.values(entry.sources);
        if (remaining.length === 0) {
            delete CharacterState.attributes[name];
        } else {
            entry.description = remaining[remaining.length - 1];
        }
    }
}
