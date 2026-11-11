// ============================================================
// LIST CONTROLS  (shared search / filter / sort toolbar)
//
// Used by the Equipment tab's market (Rynek), the Arkana tab's
// "Wielka Księga Zaklęć" and choiceDialog.js. A toolbar is described
// declaratively as rows of control specs:
//
//   { type: 'text' | 'number' | 'select' | 'checkbox',
//     id:    DOM id (must be unique on the page),
//     key:   property name on the `filters` state object,
//     flex:  optional CSS flex value,
//     placeholder / attrs / label / options: type-specific }
//
// renderFiltersHTML() builds the markup from the specs + current
// filter state; wireFilterControls() binds events that write back
// into that state and call `rerender`.
//
// PERFORMANCE NOTE: text and number inputs used to trigger a full list
// re-render on EVERY keystroke. The filter state is still updated
// immediately, but the re-render is now debounced (TEXT_INPUT_DEBOUNCE_MS)
// so typing "miecz" rebuilds the list once instead of five times.
// Selects and checkboxes still re-render immediately. Set the constant
// to 0 to restore the old per-keystroke behaviour.
// ============================================================

/** Delay, in ms, before a text/number input re-renders the list. 0 = immediately (old behaviour). */
export const TEXT_INPUT_DEBOUNCE_MS = 120;

export function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

// ---- Pure helpers ---------------------------------------------------------

/** '' / non-numeric -> null (unbounded), otherwise the number. */
export function parseBound(value) {
    return (value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)))
        ? Number(value) : null;
}

/** Case-insensitive substring test; an empty query matches everything. */
export function matchesText(haystack, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return String(haystack ?? '').toLowerCase().includes(q);
}

export function compareNames(a, b) {
    return String(a ?? '').localeCompare(String(b ?? ''), 'pl');
}

/**
 * Returns a sorted copy of `items`. `comparators` maps a sort key to
 * (a, b) => number; unknown keys (e.g. 'name') just sort
 * alphabetically. Ties always fall back to the name.
 */
export function sortWithComparators(items, sortKey, comparators = {}, getName = i => i.name) {
    const cmp = comparators[sortKey];
    return [...items].sort((a, b) => {
        if (cmp) {
            const d = cmp(a, b);
            if (d) return d;
        }
        return compareNames(getName(a), getName(b));
    });
}

// ---- Rendering ------------------------------------------------------------

function controlHTML(c, filters) {
    const v = filters[c.key];
    const flex = c.flex ? `flex:${c.flex};` : '';

    switch (c.type) {
        case 'text':
        case 'number':
            return `<input id="${c.id}" type="${c.type}" ${c.attrs || ''} placeholder="${escapeHtml(c.placeholder || '')}" value="${escapeHtml(v)}" ${flex ? `style="${flex}"` : ''} />`;

        case 'select': {
            const sel = `<select id="${c.id}" ${flex && !c.label ? `style="${flex}"` : ''}>
                ${c.options.map(o => `<option value="${escapeHtml(o.value)}" ${String(v) === String(o.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>`;
            return c.label
                ? `<label style="display:flex; align-items:center; gap:0.4em; white-space:nowrap; ${flex}">${escapeHtml(c.label)} ${sel}</label>`
                : sel;
        }

        case 'checkbox':
            return `<label style="display:flex; align-items:center; gap:0.4em; white-space:nowrap; ${flex}">
                <input type="checkbox" id="${c.id}" ${v ? 'checked' : ''} /> ${escapeHtml(c.label)}
            </label>`;

        default:
            return '';
    }
}

/** @param {object[][]} rows — rows of control specs @param {object} filters — current filter state */
export function renderFiltersHTML(rows, filters) {
    return `
        <section class="charSection listFilters-section">
            ${rows.map(row => `<div class="editor-row">${row.map(c => controlHTML(c, filters)).join('')}</div>`).join('')}
        </section>
    `;
}

// ---- Wiring ---------------------------------------------------------------

/**
 * Binds every control in `rows` so that changing it writes into
 * `filters[spec.key]` and then calls `rerender()` (debounced for
 * text/number inputs — see the header note).
 */
export function wireFilterControls(rootEl, rows, filters, rerender) {
    let timer = null;
    let anchor = null; // any wired element; used to tell whether this toolbar is still on the page

    const rerenderDebounced = () => {
        if (TEXT_INPUT_DEBOUNCE_MS <= 0) { rerender(); return; }
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            // The page may have changed (e.g. an item was opened) while we waited.
            if (anchor && !anchor.isConnected) return;
            rerender();
        }, TEXT_INPUT_DEBOUNCE_MS);
    };

    /** Runs a pending debounced render right away (used before an immediate one so state is never stale). */
    const rerenderNow = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        rerender();
    };

    for (const spec of rows.flat()) {
        const el = rootEl.querySelector(`#${spec.id}`);
        if (!el) continue;
        if (!anchor) anchor = el;

        if (spec.type === 'text' || spec.type === 'number') {
            el.addEventListener('input', (e) => { filters[spec.key] = e.target.value; rerenderDebounced(); });
        } else if (spec.type === 'select') {
            el.addEventListener('change', (e) => { filters[spec.key] = e.target.value; rerenderNow(); });
        } else if (spec.type === 'checkbox') {
            el.addEventListener('change', (e) => { filters[spec.key] = e.target.checked; rerenderNow(); });
        }
    }
}

/**
 * Runs `renderFn` (a full re-render of rootEl) while keeping keyboard
 * focus and text selection on whichever element had it — a plain
 * re-render recreates every element and would otherwise steal focus
 * from the search/price inputs.
 */
export function renderPreservingFocus(rootEl, renderFn) {
    const active = document.activeElement;
    const activeId = active && active.id;
    const hasSelection = active && typeof active.selectionStart === 'number';
    const selStart = hasSelection ? active.selectionStart : null;
    const selEnd   = hasSelection ? active.selectionEnd   : null;

    renderFn();

    if (activeId) {
        const el = rootEl.querySelector(`#${activeId}`);
        if (el) {
            el.focus();
            if (selStart !== null && typeof el.setSelectionRange === 'function') {
                try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text input — ignore */ }
            }
        }
    }
}
