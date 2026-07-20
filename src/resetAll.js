// ============================================================
// RESET ALL
//
// "One reset button to rule them all" — wipes every piece of
// persisted state this app owns (tree progress, character sheet,
// equipment, known spells, and the Character-Creation/Usage/Level-Up
// progression stage) back to a fresh-character default, then reloads
// the page so every module's module-level load() rebuilds itself
// from scratch instead of needing hand-written live-surgery on the
// running 3D scene.
//
// Deliberately does NOT touch: custom items/spells (Tryb Edycji
// content) or built-in item/spell overrides/deletions — those are
// shared GAME DATA (homebrew content), not per-character progress,
// so a character reset must not erase them.
//
// Each resetX() this calls already exists in its own module and
// already fully overwrites that module's own localStorage key — see
// characterState.js/equipmentState.js/spellState.js/
// progressionState.js/treePersistence.js. This module just knows to
// call all of them together, plus the page reload.
// ============================================================

import { resetCharacterState } from './characterState.js';
import { resetEquipmentState } from './equipmentState.js';
import { resetSpellProgressState } from './spellState.js';
import { resetProgressionState } from './progressionState.js';
import { resetTreeState } from './treePersistence.js';

/**
 * Resets every piece of per-character persisted state to its default
 * shape, then reloads the page. Does not itself prompt for
 * confirmation — the caller (characterSheet.js's "Resetuj Wszystko"
 * button) is responsible for that.
 */
export function resetEverything() {
    resetTreeState();          // which perks are active + attribute-choice picks
    resetCharacterState();     // name, potencjał, resources, damage, characteristics/abilities bases
    resetEquipmentState();     // currency + inventory
    resetSpellProgressState(); // known spells (specific + school-based grants)
    resetProgressionState();   // Tworzenie Postaci / Użytkowanie / Level Up stage + locked nodes

    window.location.reload();
}
