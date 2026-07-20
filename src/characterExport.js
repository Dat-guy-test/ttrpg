// ============================================================
// CHARACTER EXPORT / IMPORT
//
// Bundles every localStorage key that makes up ONE character's
// progress — taken perks + attribute-choice picks (treePersistence.js),
// the character sheet (characterState.js: potencjał, resources,
// damage, characteristics/abilities bases, player-spent pool points),
// equipment (currency + inventory), known spells (specific +
// school-based grants), and the Tworzenie Postaci/Użytkowanie/Level Up
// stage (progressionState.js) — into one downloadable JSON file, and
// can load that file back in.
//
// Deliberately EXCLUDED (this is a CHARACTER export, not a full save
// of the whole browser profile): custom items/spells created via
// "Tryb Edycji", and built-in item/spell overrides/deletions. Those
// are shared game-data/homebrew content, not something that travels
// with one specific character.
//
// Import works the same way resetAll.js's resetEverything() does —
// write the raw localStorage keys, then reload the page — rather
// than trying to hand-patch the live 3D scene/character sheet. This
// means every module's own load()/mergeWithDefaults() validation
// logic (already written and tested) is what actually applies the
// imported data, instead of a second parallel copy of that logic
// living here.
// ============================================================

// Keep this list in sync with each module's own STORAGE_KEY constant:
//   characterState.js   → 'ttrpgCharacterSheet.v2'
//   equipmentState.js   → 'ttrpgEquipment.v1'
//   spellState.js       → 'ttrpgKnownSpells.v1' / 'ttrpgSpellSchoolGrants.v1'
//   progressionState.js → 'ttrpgProgression.v1'
//   treePersistence.js  → 'ttrpgTreeState.v1'
const CHARACTER_STORAGE_KEYS = [
    'ttrpgCharacterSheet.v2',
    'ttrpgEquipment.v1',
    'ttrpgKnownSpells.v1',
    'ttrpgSpellSchoolGrants.v1',
    'ttrpgProgression.v1',
    'ttrpgTreeState.v1',
];

const EXPORT_FORMAT_VERSION = 1;

/** @returns {{formatVersion:number, exportedAt:string, data:object}} the full exportable character payload. */
export function exportCharacterToObject() {
    const data = {};
    for (const key of CHARACTER_STORAGE_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        try {
            data[key] = JSON.parse(raw);
        } catch (e) {
            console.error(`characterExport: couldn't parse "${key}" — omitting it from the export.`, e);
        }
    }
    return {
        formatVersion: EXPORT_FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        data,
    };
}

/** Builds the export payload and triggers a browser download of it as a .json file. */
export function downloadCharacterExport() {
    const payload = exportCharacterToObject();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const rawName = payload.data['ttrpgCharacterSheet.v2']?.name || 'postac';
    const safeName = String(rawName).trim().replace(/[^a-zA-Z0-9_\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, '_') || 'postac';

    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}-postac.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/**
 * Validates and applies an imported character payload — OVERWRITES
 * every character-related localStorage key (any key absent from the
 * import is cleared instead, so a partial/older export doesn't leave
 * stray leftovers from whatever character was loaded before). Does
 * NOT reload the page itself — the caller should do that once this
 * returns { ok: true }, so every module reloads its state fresh.
 *
 * @param {object} payload — parsed JSON, as produced by exportCharacterToObject()/downloadCharacterExport()
 * @returns {{ok:boolean, error?:string}}
 */
export function importCharacterFromObject(payload) {
    if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
        return { ok: false, error: 'Nieprawidłowy plik postaci — brakuje sekcji "data".' };
    }

    for (const key of CHARACTER_STORAGE_KEYS) {
        try {
            if (Object.prototype.hasOwnProperty.call(payload.data, key)) {
                localStorage.setItem(key, JSON.stringify(payload.data[key]));
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) {
            return { ok: false, error: `Nie udało się zapisać "${key}": ${e.message}` };
        }
    }

    return { ok: true };
}
