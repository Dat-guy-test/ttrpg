// ============================================================
// PREMADE CHARACTERS  (skill-tree tab → "Wybierz przygotowaną postać")
//
// Adds a banner with a button to the skill-tree tab (inside #bor,
// overlaid on the 3D canvas) for players who can't decide how to build
// their character. Clicking it:
//   1. warns that picking a premade character DELETES every piece of
//      current character data on the site (window.confirm),
//   2. lists every character export found in src/char/ — the names
//      shown are the character names stored INSIDE each file (the
//      "name" field of the exported character sheet), not file names,
//   3. on selection, imports that file with the very same routine
//      "Wczytaj Postać" uses (characterExport.js's
//      importCharacterFromObject()) and reloads the page so every
//      module rebuilds itself from the freshly written localStorage.
//
// FILES
// ------------------------------------------------------------
// Drop any file produced by "Zapisz Postać" into src/char/ (this
// module lives in src/ too). They're picked up with Vite's
// import.meta.glob at build time, so they end up bundled with the
// site — which is what makes this work on a static host such as
// GitHub Pages, where a folder can't be listed at runtime. In
// `npm run dev` a newly added file is picked up automatically; for a
// deployed site, rebuild after adding/removing files.
//
// VISIBILITY
// ------------------------------------------------------------
// The banner is only shown while progressionState.js's stage is
// STAGES.CREATION — i.e. it disappears once "Zakończ Tworzenie
// Postaci" has been used. The "×" button next to it hides the banner
// (and itself) for the rest of the page session. Because the stage can
// change without a reload, characterSheet.js calls
// refreshPremadeCharacterButton() right after advancing the stage.
//
// This module only imports progressionState.js and characterExport.js
// (neither imports anything tree/sheet-related), so characterSheet.js
// and main.js can import it without creating a cycle.
//
// Exports:
//   initPremadeCharacterPicker()     — call once at boot, after the DOM exists.
//   refreshPremadeCharacterButton()  — re-evaluates whether the banner should show.
// ============================================================

import { getStage, STAGES } from './progressionState.js';
import { importCharacterFromObject } from './characterExport.js';
import './premadeCharacters.css';

/** localStorage key characterState.js saves the character sheet under — the export file keeps it under payload.data[...]. */
const CHARACTER_SHEET_KEY = 'ttrpgCharacterSheet.v2';

const BUTTON_LABEL = 'Nie mogę się zdecydować - Wybierz przygotowaną wcześniej postać';

const CONFIRM_MESSAGE =
    'Czy chcesz wybrać jedną z przygotowanych wcześniej postaci?\n\n' +
    'UWAGA: wybranie postaci USUNIE wszystkie obecne dane na stronie — wybrane atuty, kartę postaci, ' +
    'ekwipunek, znane zaklęcia i etap gry — i zastąpi je danymi wybranej postaci. Tej operacji nie można cofnąć.';

// Every JSON file in src/char/, already parsed. An empty/missing folder just yields {}.
const characterFiles = import.meta.glob('./char/*.json', { eager: true, import: 'default' });

let bannerEl = null;
let dismissed = false;   // set by the "×" button; lasts until the page is reloaded
let modalEl = null;
let removeKeyListener = null;


// ============================================================
// Data
// ============================================================

function fileBaseName(path) {
    return path.split('/').pop().replace(/\.json$/i, '');
}

/**
 * @returns {{path:string, name:string, payload:object}[]} every valid
 *   character export in src/char/, sorted by character name. `name` is
 *   read from the file's contents; the file name is only a fallback for
 *   a character that was exported without a name.
 */
function listPremadeCharacters() {
    const out = [];

    for (const [path, payload] of Object.entries(characterFiles)) {
        if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
            console.warn(`premadeCharacters: "${path}" isn't a character export (no "data" section) — skipping it.`);
            continue;
        }
        const rawName = payload.data[CHARACTER_SHEET_KEY]?.name;
        const name = (typeof rawName === 'string' && rawName.trim()) ? rawName.trim() : fileBaseName(path);
        out.push({ path, name, payload });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}


// ============================================================
// Banner
// ============================================================

function shouldShowBanner() {
    return !dismissed && getStage() === STAGES.CREATION;
}

/** Shows/hides the banner (and its "×") according to the current stage and dismissal state. */
export function refreshPremadeCharacterButton() {
    if (bannerEl) bannerEl.hidden = !shouldShowBanner();
}

export function initPremadeCharacterPicker() {
    const host = document.getElementById('bor');
    if (!host) {
        console.error('premadeCharacters: no #bor element found in the DOM.');
        return;
    }

    bannerEl = document.createElement('div');
    bannerEl.className = 'premadeBanner';

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'premadeBanner-btn';
    pickBtn.textContent = BUTTON_LABEL;
    pickBtn.addEventListener('click', onPickClick);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'premadeBanner-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Ukryj';
    closeBtn.setAttribute('aria-label', 'Ukryj przycisk wyboru przygotowanej postaci');
    closeBtn.addEventListener('click', () => {
        dismissed = true;
        refreshPremadeCharacterButton();
    });

    bannerEl.append(pickBtn, closeBtn);
    host.appendChild(bannerEl);
    refreshPremadeCharacterButton();
}


// ============================================================
// Flow: confirm → list → import
// ============================================================

function onPickClick() {
    const characters = listPremadeCharacters();
    if (characters.length === 0) {
        window.alert('Nie znaleziono żadnych przygotowanych postaci (folder src/char/ jest pusty).');
        return;
    }
    if (!window.confirm(CONFIRM_MESSAGE)) return;

    openPicker(characters);
}

function closePicker() {
    if (removeKeyListener) { removeKeyListener(); removeKeyListener = null; }
    if (modalEl) { modalEl.remove(); modalEl = null; }
}

function openPicker(characters) {
    closePicker();

    modalEl = document.createElement('div');
    modalEl.className = 'premadeModal';
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closePicker(); });

    const panel = document.createElement('div');
    panel.className = 'premadePanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'premadePanelTitle');

    const title = document.createElement('h2');
    title.id = 'premadePanelTitle';
    title.className = 'premadePanel-title';
    title.textContent = 'Wybierz przygotowaną postać';

    const warning = document.createElement('p');
    warning.className = 'premadePanel-warning';
    warning.textContent = 'Wybranie postaci usunie wszystkie obecne dane na stronie.';

    const list = document.createElement('ul');
    list.className = 'premadeList';
    for (const character of characters) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'premadeList-btn';
        btn.textContent = character.name; // textContent — a name is never interpreted as HTML
        btn.addEventListener('click', () => selectCharacter(character));
        li.appendChild(btn);
        list.appendChild(li);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'charBtn premadePanel-cancel';
    cancelBtn.textContent = 'Anuluj';
    cancelBtn.addEventListener('click', closePicker);

    panel.append(title, warning, list, cancelBtn);
    modalEl.appendChild(panel);
    document.body.appendChild(modalEl);

    const onKeyDown = (e) => { if (e.key === 'Escape') closePicker(); };
    document.addEventListener('keydown', onKeyDown);
    removeKeyListener = () => document.removeEventListener('keydown', onKeyDown);

    const firstBtn = list.querySelector('button');
    if (firstBtn) firstBtn.focus();
}

function selectCharacter(character) {
    const result = importCharacterFromObject(character.payload);
    if (!result.ok) {
        window.alert(`Nie udało się wczytać postaci "${character.name}": ${result.error}`);
        return;
    }
    // Same as "Wczytaj Postać": each module's own load()/mergeWithDefaults()
    // applies the freshly written localStorage keys on the next boot.
    window.location.reload();
}
