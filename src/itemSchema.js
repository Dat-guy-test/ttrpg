// ============================================================
// ITEM SCHEMA
//
// Config for the extended item data model used by the Equipment
// tab's "Tryb Edycji" (itemEditor.js). Same idea as characterState
// .js's EFFECT_TYPES / CHARACTERISTICS_CONFIG: plain arrays of
// {value/key, label} pairs that both the editor form and the detail
// page read from, so adding a new option is a one-line edit here
// instead of a hunt through every file that cares.
//
// A custom item's shape depends on its `type`:
//   every item          — see BASE_FIELDS below (built by makeDefaultItem)
//   'weapon'             — + block, deflection, weaponKinds, proficiencyCategory,
//                           upgrades, attackModes, requirements
//   'armour'             — + isSet/setMembers, requirements, armourLevel,
//                           equipSlots, equipLayers, effectDescription,
//                           equip/unequip timing
//   'clothing','storage' — same as 'armour' minus armourLevel;
//                           'storage' additionally gets capacity and
//                           accessorySlots (see ACCESSORY_SIZES below)
//   'utility'            — + useCondition, useEffect
//   'misc'               — no extra fields
//
// Only Umiejętności (abilities) may be required to equip something —
// EQUIP_REQUIREMENT_SKILLS is literally ABILITIES_CONFIG, re-exported
// under a name that makes that restriction obvious at the call site.
//
// Every item (regardless of type) may also carry `accessorySize` —
// see ACCESSORY_SIZES — flagging it as a small/medium/large
// accessory that can occupy a matching slot in a 'storage' item's
// `accessorySlots`.
// ============================================================

import { ABILITIES_CONFIG } from './characterState.js';

export const ITEM_TYPES = [
    { value: 'weapon',   label: 'Broń' },
    { value: 'armour',   label: 'Pancerz' },
    { value: 'clothing', label: 'Ubrania' },
    { value: 'storage',  label: 'Schowek' },
    { value: 'utility',  label: 'Użytkowy' },
    { value: 'misc',     label: 'Różne' },
];

export const ITEM_STATES = [
    { value: 'unequipped', label: 'Niewyposażony' },
    { value: 'prepared',   label: 'Przygotowany' },
    { value: 'equipped',   label: 'Wyposażony' },
];

export const WEAPON_KINDS = [
    { value: 'melee',   label: 'Broń Biała' },
    { value: 'thrown',  label: 'Broń Miotana' },
    { value: 'missile', label: 'Broń Miotająca' },
];

export const ATTACK_MODE_TYPES = [
    { value: 'melee', label: 'Uderzenie Bronią' },
    { value: 'throw', label: 'Rzut Bronią' },
    { value: 'shot',  label: 'Strzał z Broni' },
];

export const HANDEDNESS_OPTIONS = [
    { value: 'one', label: 'Atak Jednoręczny' },
    { value: 'two', label: 'Atak Dwuręczny' },
];

/**
 * Dice sizes usable for Obrażenia/Rozrzut entries. 'none' is a
 * sentinel meaning "no dice — flat value only": a weapon that deals
 * (or spreads) purely fixed damage uses this instead of picking an
 * arbitrary die. See formatDiceExpression() for how a 'none' entry
 * is displayed, and formatDiceLabel() for its <option> text.
 */
export const DAMAGE_DICE = ['none', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/** Human-readable label for a DAMAGE_DICE value, for <option> text. */
export function formatDiceLabel(dice) {
    return dice === 'none' ? 'Brak (wartość stała)' : dice;
}

/**
 * Formats one Obrażenia/Rozrzut entry ({count, dice, modifier}) into
 * its display string. When `dice` is the 'none' sentinel (or falsy —
 * covers older saved data with no dice field at all), `count` is
 * ignored entirely and `modifier` alone is shown as a flat amount, so
 * a "no dice" entry reads as a plain number instead of a malformed
 * dice expression like "1none+2".
 * @param {{count:number, dice:string, modifier:number}} entry
 * @returns {string}
 */
export function formatDiceExpression(entry) {
    if (!entry) return '';
    if (!entry.dice || entry.dice === 'none') {
        return `${entry.modifier || 0}`;
    }
    const sign = entry.modifier > 0 ? '+' : '';
    const modPart = entry.modifier ? `${sign}${entry.modifier}` : '';
    return `${entry.count}${entry.dice}${modPart}`;
}

export const DAMAGE_TYPES = [
    { value: 'slashing',    label: 'Obrażenia Cięte' },
    { value: 'bludgeoning', label: 'Obrażenia Obuchowe' },
    { value: 'piercing',    label: 'Obrażenia Kłóte' },
    { value: 'temperature', label: 'Od Temperatury' },
    { value: 'poison',      label: 'Od Trucizny' },
];

export const EQUIP_SLOTS = [
    { value: 'leftPalm',  label: 'Lewa Dłoń' },
    { value: 'rightPalm', label: 'Prawa Dłoń' },
    { value: 'leftArm',   label: 'Lewe Ramię' },
    { value: 'rightArm',  label: 'Prawe Ramię' },
    { value: 'leftFoot',  label: 'Lewa Stopa' },
    { value: 'rightFoot', label: 'Prawa Stopa' },
    { value: 'leftLeg',   label: 'Lewa Noga' },
    { value: 'rightLeg',  label: 'Prawa Noga' },
    { value: 'face',      label: 'Twarz' },
    { value: 'head',      label: 'Głowa' },
    { value: 'torso',     label: 'Tors' },
    { value: 'back',      label: 'Plecy' },
    { value: 'belt',      label: 'Pas' },
];

export const EQUIP_LAYERS = [
    { value: 'underwear',   label: 'Bielizna' },
    { value: 'clothes',     label: 'Ubrania' },
    { value: 'innerArmour', label: 'Wewnętrzny Pancerz' },
    { value: 'outerArmour', label: 'Zewnętrzny Pancerz' },
    { value: 'sleekAttach', label: 'Przylegające Doczepione Przedmioty' },
    { value: 'outerAttach', label: 'Noszone Na Wierzchu' },
];

/**
 * Sizes an item may be flagged as via `accessorySize` — any item, of
 * any type, may carry one of these (or none). A 'storage' item's
 * `accessorySlots` counts how many accessories of each size it can
 * hold; nothing here enforces that relationship automatically, it's
 * just the shared vocabulary both sides read from.
 */
export const ACCESSORY_SIZES = [
    { value: 'small',  label: 'Mały' },
    { value: 'medium', label: 'Średni' },
    { value: 'large',  label: 'Duży' },
];

/** Requirement entries for equipping — { skill: <ABILITIES_CONFIG key>, min: number }. Only Umiejętności may be required (never Charakterystyki, Wprawa, etc). */
export const EQUIP_REQUIREMENT_SKILLS = ABILITIES_CONFIG;

/** True for the three item types that share the Armour-style field block (requirements/slots/layers/effects/equip-timing). */
export function typeUsesArmourFields(type) {
    return type === 'armour' || type === 'clothing' || type === 'storage';
}

// ---- Default-shape builders --------------------------------------------

/** One entry in an attack mode's Obrażenia (or Rozrzut) list: e.g. 2d6+1 Cięte, or a flat 3 (dice: 'none'). */
export function makeDamageEntry() {
    return { count: 1, dice: 'd6', modifier: 0, type: 'slashing' };
}

/** One entry in a weapon's Tryby Ataku list. */
export function makeAttackMode() {
    return {
        name: '',
        modeType: 'melee',       // ATTACK_MODE_TYPES
        handedness: 'one',       // HANDEDNESS_OPTIONS
        baseAccuracy: 0,
        damage: [],              // makeDamageEntry()[]
        minRange: 0,
        maxRange: 0,
        spread: null,            // { count, dice, modifier } — only meaningful for 'throw'/'shot'; dice may be 'none' for a flat spread
        effectiveRange: null,    // positive integer — only meaningful for 'throw'/'shot'
        specialEffect: '',
    };
}

/**
 * Builds the "empty" shape for a brand-new item of the given type.
 * itemEditor.js starts from this and overwrites fields with whatever
 * the player actually entered before calling addCustomItem().
 * @param {string} type — an ITEM_TYPES value
 */
export function makeDefaultItem(type) {
    const base = {
        id: '',
        name: '',
        price: 0,          // integer, in Nitki Konstancjum (smallest denomination)
        bulk: 0,            // Obciążenie
        type,
        desc: '',
        state: 'unequipped',
        hitPoints: 1,
        toughness: 0,
        // The Set flag/members list applies to every item type, not just the
        // Armour family — a bundle of ammunition or a matched pair of
        // daggers is just as much a "set" as a suit of armour.
        isSet: false,
        setMembers: [],     // item ids this set splits into (only shown/used when isSet)
        // Applies to every item type — flags this item as a small/medium/
        // large accessory so it can occupy a matching slot on a 'storage'
        // container's accessorySlots (see ACCESSORY_SIZES above).
        // null/'' = not an accessory.
        accessorySize: null,
    };

    if (type === 'weapon') {
        return {
            ...base,
            requirements: [],          // [{ skill, min }] — Umiejętności only
            block: 0,
            deflection: 0,
            weaponKinds: [],           // WEAPON_KINDS values, multi-select
            proficiencyCategory: '',
            upgrades: [],              // string[]
            attackModes: [],           // makeAttackMode()[]
        };
    }

    if (typeUsesArmourFields(type)) {
        return {
            ...base,
            requirements: [],
            ...(type === 'armour' ? { armourLevel: 1 } : {}),
            equipSlots: [],
            equipLayers: [],
            effectDescription: '',
            equipTimeSeconds: 0,
            equipTimeActionPoints: 0,
            unequipTimeSeconds: 0,
            unequipTimeActionPoints: 0,
            // Only 'storage' containers carry accessory slot counts —
            // how many small/medium/large accessories (see
            // accessorySize above) this container can hold.
            ...(type === 'storage' ? { capacity: 0, accessorySlots: { small: 0, medium: 0, large: 0 } } : {}),
        };
    }

    if (type === 'utility') {
        return { ...base, useCondition: '', useEffect: '' };
    }

    return base; // 'misc'
}
