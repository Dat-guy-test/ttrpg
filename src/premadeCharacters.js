// ============================================================
// PREMADE CHARACTERS  (skill-tree tab → "Wybierz przygotowaną postać")
//
// Adds a banner with a button to the skill-tree tab (inside #bor,
// overlaid on the 3D canvas). Clicking it:
//   1. loads every character export found in src/char/,
//   2. warns that picking one DELETES all current character data,
//   3. lists the characters (names come from INSIDE each file),
//   4. on selection imports it with characterExport.js's
//      importCharacterFromObject() and reloads the page.
//
// FILES: drop any "Zapisz Postać" export into src/char/. They are
// discovered with Vite's import.meta.glob at build time, so they are
// bundled with the site (works on GitHub Pages). Rebuild after
// adding/removing files for a deployed site.
//
// PERFORMANCE NOTE: the glob used to be `eager: true`, which put every
// premade character's full JSON into the main bundle that must be
// downloaded and parsed before the site boots. It is now lazy — each file
// becomes its own chunk, fetched only when the player clicks the banner
// button. Behaviour is unchanged apart from a (near-instant) fetch on click.
//
// VISIBILITY: shown only while progressionState's stage is
// STAGES.CREATION; "×" hides it for the rest of the page session.
// characterSheet.js calls refreshPremadeCharacterButton() after
// advancing the stage.
//
// Exports:
//   initPremadeCharacterPicker()
//   refreshPremadeCharacterButton()
// ============================================================

import { getStage, STAGES } from './progressionState.js';
import { importCharacterFromObject } from './characterExport.js';
import './premadeCharacters.css';

/** localStorage key characterState.js saves the character sheet under — the export keeps it under payload.data[...]. */
const CHARACTER_SHEET_KEY = 'ttrpgCharacterSheet.v2';

const BUTTON_LABEL = 'Nie mogę się zdecydować - Wybierz przygotowaną wcześniej postać';

const CONFIRM_MESSAGE =
    'Czy chcesz wybrać jedną z przygotowanych wcześniej postaci?\n\n' +
    'UWAGA: wybranie postaci USUNIE wszystkie obecne dane na stronie — wybrane atuty, kartę postaci, ' +
    'ekwipunek, znane zaklęcia i etap gry — i zastąpi je danymi wybranej postaci. Tej operacji nie można cofnąć.';

// path -> () => Promise<parsed JSON>. An empty/missing folder just yields {}.
const characterLoaders = import.meta.glob('./char/*.json', { import: 'default' });

let bannerEl = null;
let dismissed = false;   // set by the "×" button; lasts until the page is reloaded
let modalEl = null;
let removeKeyListener = null;
let loading = false;     // guards against double-clicks while the files are being fetched


// ============================================================
// Data
// ============================================================

function fileBaseName(path) {
    return path.split('/').pop().replace(/\.json$/i, '');
}

/**
 * Loads every file in src/char/ and returns the valid character exports,
 * sorted by character name. `name` is read from the file's contents; the
 * file name is only a fallback for a character exported without a name.
 * @returns {Promise<{path:string, name:string, payload:object}[]>}
 */
async function listPremadeCharacters() {
    const loaded = await Promise.all(
        Object.entries(characterLoaders).map(async ([path, load]) => {
            try {
                return [path, await load()];
            } catch (e) {
                console.warn(`premadeCharacters: couldn't load "${path}" — skipping it.`, e);
                return [path, null];
            }
        })
    );

    const out = [];
    for (const [path, payload] of loaded) {
        if (payload === null) continue;
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
// Flow: load → confirm → list → import
// ============================================================

async function onPickClick() {
    if (loading) return;
    loading = true;

    let characters;
    try {
        characters = await listPremadeCharacters();
    } finally {
        loading = false;
    }

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
