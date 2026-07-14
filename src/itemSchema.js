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
//                           'storage' additionally gets capacity
//   'utility'            — + useCondition, useEffect
//   'misc'               — no extra fields
//
// Only Umiejętności (abilities) may be required to equip something —
// EQUIP_REQUIREMENT_SKILLS is literally ABILITIES_CONFIG, re-exported
// under a name that makes that restriction obvious at the call site.
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

/** Dice sizes usable for Obrażenia/Rozrzut entries. */
export const DAMAGE_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

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

/** Requirement entries for equipping — { skill: <ABILITIES_CONFIG key>, min: number }. Only Umiejętności may be required (never Charakterystyki, Wprawa, etc). */
export const EQUIP_REQUIREMENT_SKILLS = ABILITIES_CONFIG;

/** True for the three item types that share the Armour-style field block (requirements/slots/layers/effects/equip-timing). */
export function typeUsesArmourFields(type) {
    return type === 'armour' || type === 'clothing' || type === 'storage';
}

// ---- Default-shape builders --------------------------------------------

/** One entry in an attack mode's Obrażenia (or Rozrzut) list: e.g. 2d6+1 Cięte. */
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
        spread: null,            // { count, dice, modifier } — only meaningful for 'throw'/'shot'
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
            ...(type === 'storage' ? { capacity: 0 } : {}),
        };
    }

    if (type === 'utility') {
        return { ...base, useCondition: '', useEffect: '' };
    }

    return base; // 'misc'
}
