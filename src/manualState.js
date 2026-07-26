// ============================================================
// MANUAL STATE
//
// Data model + persistence for the "Instrukcja Obsługi" tab.
// Mirrors spellState.js's structure almost exactly:
//   - manual.json's `PAGES` array is read-only built-in data.
//   - Player-created pages (Tryb Edycji) live in their own
//     localStorage key, merged with the built-ins at read time.
//   - Editing an EXISTING built-in page stores an "override" copy
//     rather than mutating manual.json.
//   - "Deleting" a built-in page soft-hides it instead.
//
// SEARCH
// ------------------------------------------------------------
// searchManual(query) looks across every current page's title AND
// every section's name (case-insensitive substring match) and
// returns a flat list of { page, section } hits — `section` is null
// for a page-title hit, or the matched section object for a
// section-name hit. manualSheet.js uses `section` (when present) to
// scroll straight to that section's anchor once the page is shown.
//
// This module deliberately imports nothing from any other app
// module (same reasoning as equipmentState.js/spellState.js) so it
// can be imported from anywhere without creating a cycle.
// ============================================================

import manualData from './manual.json';

export const PAGES = Array.isArray(manualData)
    ? manualData
    : (Array.isArray(manualData?.pages) ? manualData.pages : []);

if (!Array.isArray(manualData) && !Array.isArray(manualData?.pages)) {
    console.error('ManualState: manual.json is neither a bare array nor a { pages: [...] } object — treating it as empty. Check the file\'s shape.');
}

const CUSTOM_PAGES_STORAGE_KEY   = 'ttrpgCustomManualPages.v1';
const PAGE_OVERRIDES_STORAGE_KEY = 'ttrpgManualPageOverrides.v1';
const PAGE_DELETIONS_STORAGE_KEY = 'ttrpgDeletedBuiltInManualPages.v1';

// ------------------------------------------------------------
// CUSTOM PAGES  (created via the manual tab's Tryb Edycji)
// ------------------------------------------------------------

function loadCustomPages() {
    try {
        const raw = localStorage.getItem(CUSTOM_PAGES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('ManualState: failed to load custom pages — starting fresh.', e);
        return [];
    }
}

let customPages = loadCustomPages();

function saveCustomPages() {
    try {
        localStorage.setItem(CUSTOM_PAGES_STORAGE_KEY, JSON.stringify(customPages));
    } catch (e) {
        console.error('ManualState: failed to save custom pages.', e);
    }
}

// Same "drop it if it's since been merged into the built-in file"
// pruning as equipmentState.js's pruneMergedCustomItems() — once a
// custom page's id has been folded into manual.json (via "Eksportuj
// manual.json" + replacing the project file), the localStorage copy
// becomes a stale duplicate.
(function pruneMergedCustomPages() {
    const before = customPages.length;
    customPages = customPages.filter(p => !PAGES.some(b => b.id === p.id));
    if (customPages.length !== before) saveCustomPages();
})();

/** @returns {object[]} only the player-created custom pages (not the manual.json built-ins). */
export function getCustomPages() {
    return customPages;
}

// ------------------------------------------------------------
// BUILT-IN PAGE OVERRIDES  (editing an EXISTING manual.json page)
// ------------------------------------------------------------

function loadPageOverrides() {
    try {
        const raw = localStorage.getItem(PAGE_OVERRIDES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
        console.error('ManualState: failed to load built-in page overrides — starting fresh.', e);
        return {};
    }
}

let pageOverrides = loadPageOverrides(); // { [builtInPageId]: page }

function savePageOverrides() {
    try {
        localStorage.setItem(PAGE_OVERRIDES_STORAGE_KEY, JSON.stringify(pageOverrides));
    } catch (e) {
        console.error('ManualState: failed to save built-in page overrides.', e);
    }
}

// If a previously-overridden id has since disappeared from
// manual.json (hand-edited/replaced file), drop the stale override —
// same reasoning as equipmentState.js's pruneOrphanedOverrides().
(function pruneOrphanedPageOverrides() {
    const before = Object.keys(pageOverrides).length;
    for (const id of Object.keys(pageOverrides)) {
        if (!PAGES.some(p => p.id === id)) delete pageOverrides[id];
    }
    if (Object.keys(pageOverrides).length !== before) savePageOverrides();
})();

/** True if `id` belongs to a built-in manual.json page. */
export function isBuiltInPageId(id) {
    return PAGES.some(p => p.id === id);
}

/** True if a built-in page currently has a player-made edit override applied. */
export function hasBuiltInOverride(id) {
    return Object.prototype.hasOwnProperty.call(pageOverrides, id);
}

/**
 * Saves an edited copy of a BUILT-IN (manual.json) page as an
 * override. Throws if `id` doesn't actually belong to a built-in
 * page — a custom page is edited in place via updateCustomPage()
 * instead.
 * @param {string} id
 * @param {object} page
 * @returns {object} the stored (override) page
 */
export function updateBuiltInPage(id, page) {
    if (!PAGES.some(p => p.id === id)) {
        throw new Error(`"${id}" nie jest stroną wbudowaną — nie można nadpisać.`);
    }
    const stored = { ...page, id };
    pageOverrides[id] = stored;
    savePageOverrides();
    return stored;
}

/** Discards a built-in page's override, reverting it to the manual.json original. No-op (returns false) if it wasn't overridden. */
export function resetBuiltInPageOverride(id) {
    if (!Object.prototype.hasOwnProperty.call(pageOverrides, id)) return false;
    delete pageOverrides[id];
    savePageOverrides();
    return true;
}

// ------------------------------------------------------------
// BUILT-IN PAGE DELETIONS  ("deleting" a manual.json page)
// ------------------------------------------------------------

function loadDeletedBuiltInIds() {
    try {
        const raw = localStorage.getItem(PAGE_DELETIONS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
        console.error('ManualState: failed to load deleted built-in pages — starting fresh.', e);
        return new Set();
    }
}

let deletedBuiltInIds = loadDeletedBuiltInIds();

function saveDeletedBuiltInIds() {
    try {
        localStorage.setItem(PAGE_DELETIONS_STORAGE_KEY, JSON.stringify([...deletedBuiltInIds]));
    } catch (e) {
        console.error('ManualState: failed to save deleted built-in pages.', e);
    }
}

(function pruneStaleDeletions() {
    const before = deletedBuiltInIds.size;
    for (const id of deletedBuiltInIds) {
        if (!PAGES.some(p => p.id === id)) deletedBuiltInIds.delete(id);
    }
    if (deletedBuiltInIds.size !== before) saveDeletedBuiltInIds();
})();

/** True if `id` belongs to a built-in page that's currently soft-deleted. */
export function isBuiltInPageDeleted(id) {
    return deletedBuiltInIds.has(id);
}

/**
 * Soft-deletes a built-in (manual.json) page: hides it from
 * getAllPages()/getPageById()/searchManual() without touching
 * manual.json itself. Also clears any override for this id. Throws
 * if `id` doesn't belong to a real built-in page.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteBuiltInPage(id) {
    if (!PAGES.some(p => p.id === id)) {
        throw new Error(`"${id}" nie jest stroną wbudowaną — nie można jej usunąć w ten sposób.`);
    }
    deletedBuiltInIds.add(id);
    saveDeletedBuiltInIds();

    if (Object.prototype.hasOwnProperty.call(pageOverrides, id)) {
        delete pageOverrides[id];
        savePageOverrides();
    }
    return true;
}

/** Un-deletes a previously soft-deleted built-in page. No-op (returns false) if it wasn't deleted. */
export function restoreBuiltInPage(id) {
    if (!deletedBuiltInIds.has(id)) return false;
    deletedBuiltInIds.delete(id);
    saveDeletedBuiltInIds();
    return true;
}

/** @returns {object[]} the shipped (manual.json) versions of every currently soft-deleted built-in page. */
export function getDeletedBuiltInPages() {
    return PAGES.filter(p => deletedBuiltInIds.has(p.id));
}

// ------------------------------------------------------------
// Reads
// ------------------------------------------------------------

/** @returns {object[]} every page currently known — built-in (overrides applied, minus soft-deleted) + custom. */
export function getAllPages() {
    const builtIns = PAGES
        .filter(p => !deletedBuiltInIds.has(p.id))
        .map(p => pageOverrides[p.id] || p);
    return [...builtIns, ...customPages];
}

export function getPageById(id) {
    if (deletedBuiltInIds.has(id)) return null;
    if (pageOverrides[id]) return pageOverrides[id];
    return PAGES.find(p => p.id === id) || customPages.find(p => p.id === id) || null;
}

/**
 * Stores a new custom page. Auto-generates an id if none was
 * supplied, and refuses (throwing) if the given/generated id
 * collides with an existing built-in or custom page.
 * @param {object} page
 * @returns {object} the stored page (with its final id)
 */
export function addCustomPage(page) {
    const id = page.id && String(page.id).trim()
        ? String(page.id).trim()
        : `custom-page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (getPageById(id)) {
        throw new Error(`Identyfikator strony "${id}" jest już zajęty.`);
    }

    const stored = { ...page, id };
    customPages.push(stored);
    saveCustomPages();
    return stored;
}

/**
 * Overwrites an existing custom page in place. Throws if `id`
 * doesn't belong to a custom page (built-in pages go through
 * updateBuiltInPage() instead).
 * @param {string} id
 * @param {object} page
 * @returns {object} the stored page
 */
export function updateCustomPage(id, page) {
    const idx = customPages.findIndex(p => p.id === id);
    if (idx === -1) {
        throw new Error(`Nie znaleziono własnej strony o identyfikatorze "${id}" — być może jest to strona wbudowana (użyj updateBuiltInPage()).`);
    }
    const stored = { ...page, id };
    customPages[idx] = stored;
    saveCustomPages();
    return stored;
}

/** Removes a custom page by id (no-op, returning false, for built-in manual.json pages). */
export function removeCustomPage(id) {
    const before = customPages.length;
    customPages = customPages.filter(p => p.id !== id);
    if (customPages.length === before) return false;
    saveCustomPages();
    return true;
}

// ------------------------------------------------------------
// SEARCH
// ------------------------------------------------------------

/**
 * Case-insensitive substring search across every current page's
 * title and every section's name. Returns a flat list of hits, each
 * { page, section } — `section` is null for a page-title hit, or
 * the matched section object for a section-name hit. Title hits are
 * listed before section hits; within each group, results keep the
 * pages' natural order (built-in first, then custom).
 * @param {string} query
 * @returns {{page:object, section:object|null}[]}
 */
export function searchManual(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const pages = getAllPages();
    const titleHits = [];
    const sectionHits = [];

    for (const page of pages) {
        if ((page.title || '').toLowerCase().includes(q)) {
            titleHits.push({ page, section: null });
        }
        for (const section of (page.sections || [])) {
            if ((section.name || '').toLowerCase().includes(q)) {
                sectionHits.push({ page, section });
            }
        }
    }

    return [...titleHits, ...sectionHits];
}
