// ============================================================
// MANUAL SCHEMA
//
// Config for the "Instrukcja Obsługi" (manual) tab's page data
// model. Same role as itemSchema.js/spellSchema.js: builders for
// the "empty" shape of a page/section, so the editor form and
// manualState.js's persistence layer both agree on the same shape.
//
// A page is:
//   { id, title, sections: [{ id, name, content }] }
//
// `title` is shown big at the top of the page AND is a search key.
// Each section's `name` is shown bigger than its `content` AND is
// ALSO its own search key — searching a section name jumps straight
// to that section (see manualState.js's searchManual() and
// manualSheet.js's scroll-to-section handling).
// ============================================================

/** One entry in a page's sections list. */
export function makeManualSection() {
    return {
        id: '',      // stable anchor id — see makeSectionId()
        name: '',    // section heading; also a search key
        content: '', // free text; blank lines become paragraph breaks
    };
}

/** The "empty" shape for a brand-new manual page. */
export function makeDefaultPage() {
    return {
        id: '',
        title: '',
        sections: [],
    };
}

/**
 * Generates a reasonably stable, anchor-safe id for a new section
 * from its name (falls back to a generic base, and de-dupes against
 * `existingIds`), so a section's scroll-target anchor survives a
 * page reload / export round-trip instead of depending on its
 * position in the array.
 * @param {string} name
 * @param {string[]} [existingIds]
 * @returns {string}
 */
export function makeSectionId(name, existingIds = []) {
    const base = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'sekcja';

    let candidate = base;
    let i = 2;
    while (existingIds.includes(candidate)) {
        candidate = `${base}-${i}`;
        i++;
    }
    return candidate;
}
