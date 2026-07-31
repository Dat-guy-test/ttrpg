// ============================================================
// MANUAL  (Instrukcja Obsługi tab)
//
// Builds the whole tab into #manualPage. Same render()/
// attachHandlers() pattern as characterSheet.js / equipmentSheet.js /
// arcanaSheet.js.
//
// Two modes, tracked in module-level `view.mode`:
//   'search' — a search box over every page's title AND every
//              section's name (see manualState.js's searchManual()).
//              Typing shows a results list; clicking a result opens
//              that page below, automatically scrolled to the
//              matched section if the hit was a section name rather
//              than a page title.
//   'edit'   — "Tryb Edycji": the page form from manualEditor.js,
//              for creating a brand-new page or editing an existing
//              one (built-in or custom). Same "select from a
//              built-in/własne dropdown, plus a soft-deleted-pages
//              recovery list" pattern as equipmentSheet.js/
//              arcanaSheet.js.
//
// Exports:
//   initManualSheet()    — call once, after #manualPage exists.
//   refreshManualSheet() — full re-render; safe to call any time.
// ============================================================

import {
    getAllPages, getPageById, getCustomPages, searchManual,
    isBuiltInPageId, hasBuiltInOverride,
    getDeletedBuiltInPages, restoreBuiltInPage,
} from './manualState.js';
import { resetManualEditor, renderManualEditorHTML, wireManualEditorHandlers } from './manualEditor.js';

let rootEl = null;

const view = {
    mode: 'search',          // 'search' | 'edit'
    query: '',
    selectedPageId: null,
    scrollToSectionId: null, // section anchor to scroll to once the page renders
    editingPageId: null,     // page id (built-in or custom) being edited on the 'edit' page
};

// Results from the most recent search render, kept so a result click can
// look its {page, section} pair back up by index without re-searching
// (which could return a different list if the query changed since).
let lastSearchResults = [];

// Every currently-known page, kept so a click on the "show all pages"
// list (shown when the search box is empty — see renderAllPagesList())
// can look the clicked page back up by index without re-fetching it.
let lastAllPages = [];

function isCustomPageId(id) {
    return getCustomPages().some(p => p.id === id);
}

export function initManualSheet() {
    rootEl = document.getElementById('manualPage');
    if (!rootEl) {
        console.error('manualSheet: no #manualPage element found in the DOM.');
        return;
    }
    render();
}

export function refreshManualSheet() {
    if (rootEl) render();
}

function render() {
    rootEl.innerHTML = `
        <div class="manualSheet">
            <div class="manualSheet-toolbar">
                <button class="charBtn" id="manual-print-btn"><span>Drukuj</span></button>
                <button hidden class="charBtn" id="manual-edit-toggle"><span>${view.mode === 'edit' ? 'Wróć do wyszukiwania' : 'Tryb Edycji'}</span></button>
            </div>
            ${view.mode === 'edit' ? renderEditPage() : renderSearchPage()}
        </div>
    `;
    attachHandlers();

    // Scroll to the matched section (if a section-name hit was clicked)
    // now that the page's sections actually exist in the DOM.
    if (view.scrollToSectionId) {
        const target = rootEl.querySelector(`#manual-section-${cssEscape(view.scrollToSectionId)}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        view.scrollToSectionId = null;
    }
}

// ============================================================
// Search mode
// ============================================================

function renderSearchPage() {
    const searchBox = `
        <section class="charSection">
            <h2 class="charSection-title">Instrukcja Obsługi</h2>
            <input id="manual-search-input" type="text" class="manualSearch-input"
                   placeholder="Szukaj strony lub sekcji…" value="${escapeHtml(view.query)}" />
        </section>
    `;

    if (view.selectedPageId) {
        const page = getPageById(view.selectedPageId);
        return searchBox + renderPageDetail(page);
    }

    if (view.query.trim()) {
        return searchBox + renderSearchResults();
    }

    return searchBox + `<p class="charSection-hint">Wszystkie strony — zacznij pisać, by zawęzić wyniki do stron lub sekcji pasujących do wyszukiwania.</p>` + renderAllPagesList();
}

/** Every currently-known page (built-in + custom), shown when the search box is empty. */
function renderAllPagesList() {
    const pages = getAllPages();
    lastAllPages = pages;

    if (pages.length === 0) {
        return `<p class="charSection-hint">Brak stron.</p>`;
    }

    const rows = pages.map((page, i) => `
        <li class="equipListRow" data-all-page-index="${i}">
            <span class="equipListRow-name"><strong>${escapeHtml(page.title)}</strong></span>
            <span class="equipListRow-qty">Strona</span>
        </li>
    `).join('');

    return `<ul class="equipListRows">${rows}</ul>`;
}

function renderSearchResults() {
    const results = searchManual(view.query);
    lastSearchResults = results;

    if (results.length === 0) {
        return `<p class="charSection-hint">Brak wyników dla „${escapeHtml(view.query)}”.</p>`;
    }

    const rows = results.map((hit, i) => {
        const label = hit.section
            ? `${escapeHtml(hit.page.title)} — <strong>${escapeHtml(hit.section.name)}</strong>`
            : `<strong>${escapeHtml(hit.page.title)}</strong>`;
        return `
            <li class="equipListRow" data-result-index="${i}">
                <span class="equipListRow-name">${label}</span>
                <span class="equipListRow-qty">${hit.section ? 'Sekcja' : 'Strona'}</span>
            </li>
        `;
    }).join('');

    return `<ul class="equipListRows">${rows}</ul>`;
}

function renderPageDetail(page) {
    if (!page) {
        return `
            <section class="charSection">
                <p class="charSection-hint">Nie znaleziono strony.</p>
                <button class="charBtn" id="manual-back-btn">&larr; Nowe wyszukiwanie</button>
            </section>
        `;
    }

    const sections = (page.sections || []).map(s => `
        <div class="manualSection" id="manual-section-${escapeAttr(s.id)}">
            <h3 class="manualSection-name">${escapeHtml(s.name)}</h3>
            <p class="manualSection-content">${escapeHtml(s.content)}</p>
        </div>
    `).join('');

    return `
        <section class="charSection">
            <button class="charBtn" id="manual-back-btn">&larr; Nowe wyszukiwanie</button>
            <h1 class="manualPage-title">${escapeHtml(page.title)}</h1>
            ${sections || '<p class="charSection-hint">Ta strona nie ma jeszcze żadnych sekcji.</p>'}
        </section>
    `;
}

// ============================================================
// Edit mode
// ============================================================

function renderEditPage() {
    const customPages  = getCustomPages();
    // getAllPages() returns built-ins (with any override applied) followed
    // by custom pages — filtering out custom ids leaves just the built-ins.
    const builtInPages = getAllPages().filter(p => !isCustomPageId(p.id));

    return `
        <div class="editor-row" style="margin-bottom:1em;">
            <div style="flex:1;">
                <label class="charField-label" for="manual-edit-page-select">Edytowana strona</label>
                <select id="manual-edit-page-select">
                    <option value="">— Nowa strona —</option>
                    <optgroup label="Wbudowane (manual.json)">
                        ${builtInPages.map(p => `
                            <option value="${escapeAttr(p.id)}" ${view.editingPageId === p.id ? 'selected' : ''}>
                                ${escapeHtml(p.title)}${hasBuiltInOverride(p.id) ? ' (zmodyfikowana)' : ''}
                            </option>
                        `).join('')}
                    </optgroup>
                    <optgroup label="Własne">
                        ${customPages.map(p => `<option value="${escapeAttr(p.id)}" ${view.editingPageId === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
                    </optgroup>
                </select>
            </div>
        </div>
        <p class="charSection-hint">Wybranie strony wbudowanej pozwala ją edytować — zapis tworzy lokalne nadpisanie zamiast zmieniać plik manual.json.</p>
        ${renderDeletedPagesSection()}
        ${renderManualEditorHTML()}
    `;
}

/** Recovery list for soft-deleted built-in pages — see manualState.js's getDeletedBuiltInPages(). Empty when nothing is deleted. */
function renderDeletedPagesSection() {
    const deleted = getDeletedBuiltInPages();
    if (deleted.length === 0) return '';

    return `
        <section class="charSection" style="margin-top:0.5em;">
            <h3 class="charSection-title">Usunięte strony (wbudowane)</h3>
            <p class="charSection-hint">Te strony wbudowane zostały ukryte, ale plik manual.json wciąż je zawiera. Przywróć, by znów były dostępne.</p>
            <ul class="equipListRows">
                ${deleted.map(p => `
                    <li class="equipListRow" style="cursor:default;">
                        <span class="equipListRow-name">${escapeHtml(p.title)}</span>
                        <button class="charBtn charBtn-small" data-restore-builtin-page="${escapeAttr(p.id)}">Przywróć</button>
                    </li>
                `).join('')}
            </ul>
        </section>
    `;
}

// ============================================================
// Event wiring
// ============================================================

function attachHandlers() {
    rootEl.querySelector('#manual-print-btn').addEventListener('click', () => window.print());

    rootEl.querySelector('#manual-edit-toggle').addEventListener('click', () => {
        if (view.mode === 'edit') {
            view.mode = 'search';
        } else {
            view.mode = 'edit';
            view.editingPageId = null;
            resetManualEditor();
        }
        render();
    });

    if (view.mode === 'search') {
        const searchInput = rootEl.querySelector('#manual-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                view.query = e.target.value;
                view.selectedPageId = null;
                render();
                // A full re-render recreates the input element, which would
                // otherwise steal focus/cursor position away on every
                // keystroke — restore both immediately after.
                const fresh = rootEl.querySelector('#manual-search-input');
                if (fresh) {
                    fresh.focus();
                    fresh.setSelectionRange(fresh.value.length, fresh.value.length);
                }
            });
        }

        rootEl.querySelectorAll('[data-result-index]').forEach(row => {
            row.addEventListener('click', () => {
                const hit = lastSearchResults[Number(row.dataset.resultIndex)];
                if (!hit) return;
                view.selectedPageId = hit.page.id;
                view.scrollToSectionId = hit.section ? hit.section.id : null;
                render();
            });
        });

        rootEl.querySelectorAll('[data-all-page-index]').forEach(row => {
            row.addEventListener('click', () => {
                const page = lastAllPages[Number(row.dataset.allPageIndex)];
                if (!page) return;
                view.selectedPageId = page.id;
                view.scrollToSectionId = null;
                render();
            });
        });

        const backBtn = rootEl.querySelector('#manual-back-btn');
        if (backBtn) backBtn.addEventListener('click', () => {
            view.selectedPageId = null;
            render();
        });
    } else {
        rootEl.querySelector('#manual-edit-page-select').addEventListener('change', (e) => {
            const id = e.target.value || null;
            view.editingPageId = id;
            resetManualEditor(id ? getPageById(id) : null);
            render();
        });
        rootEl.querySelectorAll('[data-restore-builtin-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                restoreBuiltInPage(btn.dataset.restoreBuiltinPage);
                render();
            });
        });
        wireManualEditorHandlers(rootEl, () => {
            view.editingPageId = null;
            view.mode = 'search';
            render();
        });
    }
}

// ============================================================
// Small helpers
// ============================================================

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function escapeAttr(str) {
    return escapeHtml(str);
}

/** Minimal CSS.escape fallback for building an id selector from arbitrary section ids — hand-edited data could contain a stray character makeSectionId() wouldn't produce. */
function cssEscape(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
