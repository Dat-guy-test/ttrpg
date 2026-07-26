// ============================================================
// MANUAL EDITOR  (Instrukcja Obsługi tab → "Tryb Edycji")
//
// Builds the form used to create a brand-new manual page, or edit
// an existing one (built-in or custom). Mirrors spellEditor.js's
// structure:
//
//   - Sekcje (sections) is a small staged sub-list (draft.sections),
//     same pattern as itemEditor.js's Tryby Ataku / spellEditor.js's
//     Efekty Zaklęcia: a mini-form (Nazwa Sekcji + Treść) that gets
//     pushed onto the list one at a time, each with its own ✕ to
//     remove it.
//
// Editing: resetManualEditor(existingPage) loads an existing page
// (built-in or custom) into the form. Which save path is used
// (updateBuiltInPage vs updateCustomPage) is decided at save time
// purely by isBuiltInPageId(editingId) — same as itemEditor.js/
// spellEditor.js.
//
// Exports:
//   resetManualEditor(existingPage?)
//   renderManualEditorHTML()
//   wireManualEditorHandlers(rootEl, onSaved)
// ============================================================

import { makeDefaultPage, makeSectionId } from './manualSchema.js';
import {
    addCustomPage, updateCustomPage, removeCustomPage, getAllPages,
    isBuiltInPageId, updateBuiltInPage, deleteBuiltInPage,
} from './manualState.js';

let draft = null;       // { sections: [] } — staged sections
let editingPage = null; // the page (built-in OR custom) currently being edited, or null when creating a new one

/**
 * Resets the form. Pass an existing page (built-in or custom) to
 * load it for editing; call with no argument to start a fresh page.
 * @param {object} [existingPage]
 */
export function resetManualEditor(existingPage) {
    editingPage = existingPage || null;
    draft = {
        sections: existingPage && Array.isArray(existingPage.sections)
            ? existingPage.sections.map(s => ({ ...s }))
            : [],
    };
}
resetManualEditor();

export function renderManualEditorHTML() {
    const p = editingPage;
    const editingBuiltIn = !!(p && isBuiltInPageId(p.id));
    const titleSuffix = editingBuiltIn ? ' (strona wbudowana)' : '';

    return `
        <section class="charSection">
            <h2 class="charSection-title">${p ? `Edytuj: ${escapeHtml(p.title)}${titleSuffix}` : 'Nowa Strona'}</h2>
            ${editingBuiltIn ? `<p class="charSection-hint">To strona wbudowana (manual.json). Zapis nie nadpisuje pliku — tworzy lokalne nadpisanie, które ma pierwszeństwo wszędzie, dopóki nie wyeksportujesz manual.json i nie podmienisz nim pliku w projekcie, lub nie klikniesz „Przywróć oryginał”.</p>` : ''}
            <div id="manual-editor-status" class="editor-status"></div>

            <label class="charField-label" for="me-title">Tytuł (widoczny na górze strony, też klucz wyszukiwania)</label>
            <input id="me-title" type="text" value="${escapeHtml(p?.title || '')}" placeholder="np. Tworzenie Postaci" />

            <label class="charField-label">Sekcje</label>
            <div id="manual-editor-sections-list">${renderSectionsList()}</div>
            <div class="itemEditor-subform">
                <label class="charField-label" for="me-sec-name">Nazwa sekcji (widoczna większą czcionką, też klucz wyszukiwania)</label>
                <input id="me-sec-name" type="text" placeholder="np. Charakterystyki" />
                <label class="charField-label" for="me-sec-content">Treść sekcji</label>
                <textarea id="me-sec-content" rows="6" placeholder="Treść… (puste linie = nowy akapit)"></textarea>
                <button class="editor-btn editor-btn-small" id="me-sec-add-btn">Dodaj Sekcję</button>
            </div>

            <div class="editor-row" style="margin-top:1em;">
                <button class="charBtn editor-save-btn" id="manual-editor-create-btn">${p ? 'Zapisz Zmiany' : 'Utwórz Stronę'}</button>
                ${p ? `<button class="charBtn charBtn-danger" id="manual-editor-delete-btn">Usuń stronę</button>` : ''}
            </div>
            <div class="editor-row">
                <button class="charBtn" id="manual-editor-export-btn">Eksportuj manual.json (wbudowane + własne)</button>
            </div>
            <p class="charSection-hint">Nowe/edytowane strony są zapisywane lokalnie i widoczne od razu. Eksport łączy wbudowane strony — wraz z ewentualnymi nadpisaniami — z własnymi w jeden gotowy plik manual.json, którym można podmienić plik w projekcie bez ręcznego scalania.</p>
        </section>
    `;
}

function renderSectionsList() {
    if (draft.sections.length === 0) return '<em>Brak sekcji.</em>';
    return draft.sections.map((s, i) => `
        <div class="editor-req-row" style="flex-direction:column; align-items:flex-start; gap:0.2em;">
            <span><strong>${escapeHtml(s.name)}</strong></span>
            <span>${escapeHtml(truncate(s.content, 140))}</span>
            <button class="editor-btn editor-btn-small" data-remove-section="${i}">✕ Usuń sekcję</button>
        </div>
    `).join('');
}

function truncate(str, n) {
    const s = String(str || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
}

export function wireManualEditorHandlers(rootEl, onSaved) {
    const statusEl = rootEl.querySelector('#manual-editor-status');
    const setStatus = (msg, isError) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('editor-status-error', !!isError);
    };

    // ---- Sekcje ---------------------------------------------------
    function refreshSectionsList() {
        const listEl = rootEl.querySelector('#manual-editor-sections-list');
        if (!listEl) return;
        listEl.innerHTML = renderSectionsList();
        listEl.querySelectorAll('[data-remove-section]').forEach(btn => {
            btn.addEventListener('click', () => {
                draft.sections.splice(Number(btn.dataset.removeSection), 1);
                refreshSectionsList();
            });
        });
    }
    refreshSectionsList();

    rootEl.querySelector('#me-sec-add-btn').addEventListener('click', () => {
        const nameInput    = rootEl.querySelector('#me-sec-name');
        const contentInput = rootEl.querySelector('#me-sec-content');
        const name    = nameInput.value.trim();
        const content = contentInput.value;

        if (!name) { setStatus('Sekcja wymaga nazwy.', true); return; }

        const existingIds = draft.sections.map(s => s.id);
        const id = makeSectionId(name, existingIds);
        draft.sections.push({ id, name, content });

        nameInput.value = '';
        contentInput.value = '';
        refreshSectionsList();
        setStatus('');
    });

    // ---- Create / Save Page ------------------------------------------
    rootEl.querySelector('#manual-editor-create-btn').addEventListener('click', () => {
        const title = rootEl.querySelector('#me-title').value.trim();
        if (!title) { setStatus('Tytuł nie może być pusty.', true); return; }
        if (draft.sections.length === 0) { setStatus('Dodaj przynajmniej jedną sekcję.', true); return; }

        const page = {
            ...makeDefaultPage(),
            title,
            sections: draft.sections.map(s => ({ ...s })),
        };

        const editingId = editingPage ? editingPage.id : null;

        try {
            let stored;
            if (!editingId) {
                stored = addCustomPage(page);
            } else if (isBuiltInPageId(editingId)) {
                stored = updateBuiltInPage(editingId, { ...page, id: editingId });
            } else {
                stored = updateCustomPage(editingId, { ...page, id: editingId });
            }
            resetManualEditor();
            setStatus(`${editingId ? 'Zapisano' : 'Utworzono'} "${stored.title}".`);
            if (typeof onSaved === 'function') onSaved(stored);
        } catch (e) {
            setStatus(e.message || 'Nie udało się zapisać strony.', true);
        }
    });

    // ---- Delete Page ---------------------------------------------------
    const deleteBtn = rootEl.querySelector('#manual-editor-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!editingPage) return;
            const id = editingPage.id;
            const title = editingPage.title;
            const builtIn = isBuiltInPageId(id);

            const confirmMsg = builtIn
                ? `Usunąć stronę wbudowaną "${title}"? Plik manual.json pozostanie nietknięty — stronę można przywrócić później z listy "Usunięte strony" w Tryb Edycji.`
                : `Usunąć własną stronę "${title}"? Tej operacji nie można cofnąć.`;
            if (!window.confirm(confirmMsg)) return;

            try {
                const ok = builtIn ? deleteBuiltInPage(id) : removeCustomPage(id);
                if (!ok) { setStatus('Nie udało się usunąć strony.', true); return; }

                resetManualEditor();
                setStatus(`Usunięto "${title}".`);
                if (typeof onSaved === 'function') onSaved(null);
            } catch (e) {
                setStatus(e.message || 'Nie udało się usunąć strony.', true);
            }
        });
    }

    // ---- Export ---------------------------------------------------------
    rootEl.querySelector('#manual-editor-export-btn').addEventListener('click', () => {
        const data = { pages: getAllPages() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'manual.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus('Wyeksportowano manual.json (wbudowane, z nadpisaniami, bez usuniętych + własne strony) — podmień nim plik w projekcie.');
    });
}

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
