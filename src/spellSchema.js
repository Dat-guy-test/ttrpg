// ============================================================
// SPELL SCHEMA
//
// Config for the spell compendium data model used by the Arkana
// tab's "Wielka Księga Zaklęć" magic editor (spellEditor.js). Same
// role as itemSchema.js for items.json: plain arrays of
// {value, label} pairs the editor form and detail page both read
// from, so adding a new option is a one-line edit here instead of a
// hunt through every file that cares.
//
// A set spell (a spell in the compendium) always carries every field
// below; several fields are only ever SHOWN (never hidden from the
// data model) when a corresponding flag is set:
//   - channelingMethods / channelingActionPointCost / channelingCost
//     — only shown when `channeling` is true
//   - materialCost — only shown when `requiresTransmutativeMaterial`
//     is true
//   - otherPrerequisites — only shown when non-empty
// See spellEditor.js / arcanaSheet.js for where that visibility is
// applied.
// ============================================================

export const SPELL_SCHOOLS = [
    { value: 'creation',      label: 'Szkoła Kreacji' },
    { value: 'projection',    label: 'Szkoła Projekcji' },
    { value: 'transmutation', label: 'Szkoła Transmutacji' },
    { value: 'summoning',     label: 'Szkoła Przywoływania' },
    { value: 'destruction',   label: 'Szkoła Destrukcji' },
    { value: 'unknown',       label: 'Szkoła nieznana' },
];

/** Shared by both "Sposób Rzucania Zaklęcia" and "Sposób Podtrzymywania Zaklęcia" — same vocabulary, two independent fields. */
export const CASTING_METHODS = [
    { value: 'thought',      label: 'Myśl' },
    { value: 'wordsOfPower', label: 'Słowa Mocy' },
    { value: 'gesture',      label: 'Gest' },
    { value: 'arcaneLens',   label: 'Magiczna Soczewka' },
];

export const SPELL_EFFECT_TYPES = [
    { value: 'createMatter',     label: 'Kreacja Materii' },
    { value: 'createEnergy',     label: 'Kreacja Energii' },
    { value: 'createProjection', label: 'Tworzenie Projekcji' },
    { value: 'createAura',       label: 'Tworzenie Aury' },
    { value: 'summonEntity',     label: 'Przywoływanie Bytu' },
    { value: 'other',            label: 'Inny' },
];

/** One entry in a spell's effects list. */
export function makeSpellEffect() {
    return {
        types: [],          // SPELL_EFFECT_TYPES values, multi-select
        maxFocalRange: 0,   // "Maksymalny Zasięg Ogniska"
        description: '',    // "Opis efektu"
    };
}

/** The "empty" shape for a brand-new compendium spell. */
export function makeDefaultSpell() {
    return {
        id: '',
        name: '',
        desc: '',
        schools: [],                    // SPELL_SCHOOLS values, multi-select
        complexity: 1,                  // integer
        castingMethods: [],             // CASTING_METHODS values, multi-select
        channeling: false,
        channelingMethods: [],          // only meaningful while channeling === true
        actionPointCost: 1,
        channelingActionPointCost: 0,   // only meaningful while channeling === true
        invocationCost: 0,
        channelingCost: 0,              // only meaningful while channeling === true
        requiresTransmutativeMaterial: false,
        materialCost: 0,                // only meaningful while requiresTransmutativeMaterial === true
        otherPrerequisites: '',         // free text; shown only when non-empty
        effects: [],                    // makeSpellEffect()[]
    };
}
