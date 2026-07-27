// ============================================================
// MAGIC EDITOR  (Arkana tab → "Wielka Księga Zaklęć" → Tryb Edycji)
//
// Builds the form used to create brand-new compendium spells, or
// edit an existing one (built-in or custom). Mirrors itemEditor.js's
// structure closely:
//
//   - Conditional fields (Sposób Podtrzymywania / Punkty Akcji
//     Podtrzymywania / Koszt Podtrzymywania while `channeling` is
//     checked; Koszt Materialny while `requiresTransmutativeMaterial`
//     is checked) are toggled via plain show/hide, same as
//     itemEditor.js's type-dependent sections — so unchecking a flag
//     never wipes out whatever was typed into the field it hides.
//
//   - Efekty Zaklęcia (the effects list) is a small staged sub-list,
//     same pattern as itemEditor.js's Tryby Ataku: a mini-form (Typ
//     multi-select + Maksymalny Zasięg Ogniska + Opis Efektu) that
//     gets pushed onto `draft.effects` one at a time.
//
// Editing: resetSpellEditor(existingSpell) loads an existing spell
// (built-in or custom) into the form. Which save path is used
// (updateBuiltInSpell vs updateCustomSpell) is decided at save time
// purely by isBuiltInSpellId(editingId) — same as itemEditor.js.
//
// Exports:
//   resetSpellEditor(existingSpell?)
//   renderSpellEditorHTML()
//   wireSpellEditorHandlers(rootEl, onSaved)
// ============================================================

import { SPELL_SCHOOLS, CASTING_METHODS, SPELL_EFFECT_TYPES, makeDefaultSpell } from './spellSchema.js';
import {
    addCustomSpell, updateCustomSpell, removeCustomSpell, getAllSpells,
    isBuiltInSpellId, updateBuiltInSpell, deleteBuiltInSpell,
} from './spellState.js';

let draft = null;        // { effects: [] } — staged Efekty Zaklęcia
let editingSpell = null; // the spell (built-in OR custom) currently being edited, or null when creating new
let editingEffectIndex = null; // index into draft.effects currently loaded into the Efekty Zaklęcia mini-form for editing, or null when the mini-form is in "add new" mode

export function resetSpellEditor(existingSpell) {
    editingSpell = existingSpell || null;
    draft = {
        effects: existingSpell && Array.isArray(existingSpell.effects)
            ? existingSpell.effects.map(e => ({ ...e, types: [...(e.types || [])] }))
            : [],
    };
    editingEffectIndex = null;
}
resetSpellEditor();

export function renderSpellEditorHTML() {
    const s = editingSpell;
    const editingBuiltIn = !!(s && isBuiltInSpellId(s.id));
    const titleSuffix = editingBuiltIn ? ' (zaklęcie wbudowane)' : '';
    const schools = new Set((s && s.schools) || []);
    const castingMethods = new Set((s && s.castingMethods) || []);
    const channelingMethods = new Set((s && s.channelingMethods) || []);
    const channeling = !!(s && s.channeling);
    const requiresMaterial = !!(s && s.requiresTransmutativeMaterial);

    return `
        <section class="charSection">
            <h2 class="charSection-title">${s ? `Edytuj: ${escapeHtml(s.name)}${titleSuffix}` : 'Nowe Zaklęcie'}</h2>
            ${editingBuiltIn ? `<p class="charSection-hint">To zaklęcie wbudowane (spells.json). Zapis nie nadpisuje pliku — tworzy lokalne nadpisanie, które ma pierwszeństwo, dopóki nie wyeksportujesz spells.json i nie podmienisz nim pliku w projekcie, lub nie przywrócisz oryginału.</p>` : ''}
            <div id="spell-editor-status" class="editor-status"></div>

            <label class="charField-label" for="se-name">Nazwa</label>
            <input id="se-name" type="text" value="${escapeHtml(s?.name || '')}" />

            <label class="charField-label" for="se-desc">Opis</label>
            <textarea id="se-desc" rows="3">${escapeHtml(s?.desc || '')}</textarea>

            <label class="charField-label">Szkoła Magii</label>
            <div class="editor-checkboxGroup">
                ${SPELL_SCHOOLS.map(o => `
                    <label><input type="checkbox" class="se-school-cb" value="${o.value}" ${schools.has(o.value) ? 'checked' : ''}/> ${escapeHtml(o.label)}</label>
                `).join('')}
            </div>

            <label class="charField-label" for="se-complexity">Złożoność</label>
            <input id="se-complexity" type="number" step="1" value="${s?.complexity ?? 1}" />

            <label class="charField-label">Sposób Rzucania Zaklęcia</label>
            <div class="editor-checkboxGroup">
                ${CASTING_METHODS.map(o => `
                    <label><input type="checkbox" class="se-cast-cb" value="${o.value}" ${castingMethods.has(o.value) ? 'checked' : ''}/> ${escapeHtml(o.label)}</label>
                `).join('')}
            </div>

            <label class="charField-label" for="se-apcost">Koszt Rzucenia w Punktach Akcji</label>
            <input id="se-apcost" type="number" step="1" value="${s?.actionPointCost ?? 1}" />

            <label class="charField-label" for="se-invocationcost">Koszt Inwokacji</label>
            <input id="se-invocationcost" type="number" step="1" value="${s?.invocationCost ?? 0}" />

            <label><input type="checkbox" id="se-channeling" ${channeling ? 'checked' : ''} /> Zaklęcie Podtrzymywane</label>
            <div id="se-channeling-wrap" style="display:${channeling ? '' : 'none'};">
                <label class="charField-label">Sposób Podtrzymywania Zaklęcia</label>
                <div class="editor-checkboxGroup">
                    ${CASTING_METHODS.map(o => `
                        <label><input type="checkbox" class="se-chanmethod-cb" value="${o.value}" ${channelingMethods.has(o.value) ? 'checked' : ''}/> ${escapeHtml(o.label)}</label>
                    `).join('')}
                </div>
                <label class="charField-label" for="se-chan-apcost">Punkty Akcji Podtrzymywania Zaklęcia</label>
                <input id="se-chan-apcost" type="number" step="1" value="${s?.channelingActionPointCost ?? 0}" />
                <label class="charField-label" for="se-chancost">Koszt Podtrzymywania</label>
                <input id="se-chancost" type="number" step="1" value="${s?.channelingCost ?? 0}" />
            </div>

            <label><input type="checkbox" id="se-reqmaterial" ${requiresMaterial ? 'checked' : ''} /> Transmutuje Materiał</label>
            <div id="se-material-wrap" style="display:${requiresMaterial ? '' : 'none'};">
                <label class="charField-label" for="se-materialcost">Koszt Materialny</label>
                <input id="se-materialcost" type="number" step="1" value="${s?.materialCost ?? 0}" />
            </div>

            <label class="charField-label" for="se-otherprereq">Inne Wymagania</label>
            <textarea id="se-otherprereq" rows="2">${escapeHtml(s?.otherPrerequisites || '')}</textarea>

            <label class="charField-label">Efekty Zaklęcia</label>
            <div id="spell-editor-effects-list">${renderSpellEffectsList()}</div>
            <div class="itemEditor-subform">
                <label class="charField-label">Typ</label>
                <div class="editor-checkboxGroup">
                    ${SPELL_EFFECT_TYPES.map(o => `<label><input type="checkbox" class="se-efftype-cb" value="${o.value}" /> ${escapeHtml(o.label)}</label>`).join('')}
                </div>
                <label class="charField-label" for="se-eff-range">Maksymalny Zasięg Ogniska</label>
                <input id="se-eff-range" type="number" min="0" step="1" value="0" />
                <label class="charField-label" for="se-eff-desc">Opis efektu</label>
                <textarea id="se-eff-desc" rows="2"></textarea>
                <div class="editor-row">
                    <button class="editor-btn editor-btn-small" id="se-eff-add-btn">Dodaj Efekt</button>
                    <button class="editor-btn editor-btn-small" id="se-eff-cancel-btn" style="display:none;">Anuluj edycję</button>
                </div>
            </div>

            <div class="editor-row" style="margin-top:1em;">
                <button class="charBtn editor-save-btn" id="spell-editor-create-btn">${s ? 'Zapisz Zmiany' : 'Utwórz Zaklęcie'}</button>
                ${s ? `<button class="charBtn charBtn-danger" id="spell-editor-delete-btn">Usuń zaklęcie</button>` : ''}
            </div>
            <div class="editor-row">
                <button class="charBtn" id="spell-editor-export-btn">Eksportuj spells.json (wbudowane + własne)</button>
            </div>
            <p class="charSection-hint">Nowe/edytowane zaklęcia są zapisywane lokalnie i widoczne od razu w grze. Eksport łączy wbudowane zaklęcia (z ewentualnymi nadpisaniami) z własnymi w jeden gotowy plik spells.json.</p>
        </section>
    `;
}

function renderSpellEffectsList() {
    if (draft.effects.length === 0) return '<em>Brak efektów.</em>';
    return draft.effects.map((e, i) => {
        const typeLabels = (e.types || []).map(t => (SPELL_EFFECT_TYPES.find(o => o.value === t) || {}).label || t).join(', ');
        return `
            <div class="editor-req-row" style="flex-direction:column; align-items:flex-start; gap:0.2em;">
                <span><strong>${escapeHtml(typeLabels || '(brak typu)')}</strong> — Zasięg Ogniska: ${e.maxFocalRange}</span>
                ${e.description ? `<span>${escapeHtml(e.description)}</span>` : ''}
                <div class="editor-row">
                    <button class="editor-btn editor-btn-small" data-edit-spelleffect="${i}">Edytuj efekt</button>
                    <button class="editor-btn editor-btn-small" data-remove-spelleffect="${i}">✕ Usuń efekt</button>
                </div>
            </div>
        `;
    }).join('');
}

export function wireSpellEditorHandlers(rootEl, onSaved) {
    const statusEl = rootEl.querySelector('#spell-editor-status');
    const setStatus = (msg, isError) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('editor-status-error', !!isError);
    };

    const channelingCb = rootEl.querySelector('#se-channeling');
    const channelingWrap = rootEl.querySelector('#se-channeling-wrap');
    channelingCb.addEventListener('change', () => {
        channelingWrap.style.display = channelingCb.checked ? '' : 'none';
    });

    const materialCb = rootEl.querySelector('#se-reqmaterial');
    const materialWrap = rootEl.querySelector('#se-material-wrap');
    materialCb.addEventListener('change', () => {
        materialWrap.style.display = materialCb.checked ? '' : 'none';
    });

    // ---- Efekty Zaklęcia --------------------------------------------
    const effAddBtn    = rootEl.querySelector('#se-eff-add-btn');
    const effCancelBtn = rootEl.querySelector('#se-eff-cancel-btn');

    /** Resets the Efekty Zaklęcia mini-form back to "add a new effect" mode. */
    function resetSpellEffectMiniForm() {
        editingEffectIndex = null;
        rootEl.querySelectorAll('.se-efftype-cb').forEach(cb => { cb.checked = false; });
        rootEl.querySelector('#se-eff-range').value = 0;
        rootEl.querySelector('#se-eff-desc').value = '';
        effAddBtn.textContent = 'Dodaj Efekt';
        effCancelBtn.style.display = 'none';
    }

    function refreshEffectsList() {
        const listEl = rootEl.querySelector('#spell-editor-effects-list');
        if (!listEl) return;
        listEl.innerHTML = renderSpellEffectsList();
        listEl.querySelectorAll('[data-remove-spelleffect]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.removeSpelleffect);
                draft.effects.splice(idx, 1);
                // Removing the effect currently loaded for editing (or one
                // before it) would otherwise silently save over the wrong
                // entry — safest is to just drop back to "add new".
                if (editingEffectIndex !== null && idx <= editingEffectIndex) resetSpellEffectMiniForm();
                refreshEffectsList();
            });
        });
        listEl.querySelectorAll('[data-edit-spelleffect]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.editSpelleffect);
                const effect = draft.effects[idx];
                if (!effect) return;

                editingEffectIndex = idx;
                const types = new Set(effect.types || []);
                rootEl.querySelectorAll('.se-efftype-cb').forEach(cb => { cb.checked = types.has(cb.value); });
                rootEl.querySelector('#se-eff-range').value = effect.maxFocalRange;
                rootEl.querySelector('#se-eff-desc').value = effect.description || '';

                effAddBtn.textContent = 'Zapisz Efekt';
                effCancelBtn.style.display = '';
                setStatus('');
            });
        });
    }
    refreshEffectsList();

    effCancelBtn.addEventListener('click', () => {
        resetSpellEffectMiniForm();
        setStatus('');
    });

    effAddBtn.addEventListener('click', () => {
        const types = Array.from(rootEl.querySelectorAll('.se-efftype-cb:checked')).map(cb => cb.value);
        const maxFocalRange = Number(rootEl.querySelector('#se-eff-range').value);
        const description = rootEl.querySelector('#se-eff-desc').value.trim();

        if (types.length === 0) { setStatus('Efekt zaklęcia wymaga przynajmniej jednego Typu.', true); return; }
        if (!Number.isFinite(maxFocalRange) || maxFocalRange < 0) { setStatus('Maksymalny Zasięg Ogniska musi być nieujemną liczbą.', true); return; }

        if (editingEffectIndex !== null) {
            draft.effects[editingEffectIndex] = { types, maxFocalRange, description };
        } else {
            draft.effects.push({ types, maxFocalRange, description });
        }

        resetSpellEffectMiniForm();
        refreshEffectsList();
        setStatus('');
    });

    // ---- Create / Save ------------------------------------------------
    rootEl.querySelector('#spell-editor-create-btn').addEventListener('click', () => {
        const name = rootEl.querySelector('#se-name').value.trim();
        const desc = rootEl.querySelector('#se-desc').value;
        const schools = Array.from(rootEl.querySelectorAll('.se-school-cb:checked')).map(cb => cb.value);
        const complexity = Number(rootEl.querySelector('#se-complexity').value);
        const castingMethods = Array.from(rootEl.querySelectorAll('.se-cast-cb:checked')).map(cb => cb.value);
        const actionPointCost = Number(rootEl.querySelector('#se-apcost').value);
        const invocationCost = Number(rootEl.querySelector('#se-invocationcost').value);
        const channeling = channelingCb.checked;
        const requiresTransmutativeMaterial = materialCb.checked;
        const otherPrerequisites = rootEl.querySelector('#se-otherprereq').value.trim();

        if (!name) { setStatus('Nazwa nie może być pusta.', true); return; }
        if (!Number.isFinite(complexity) || !Number.isInteger(complexity)) { setStatus('Złożoność musi być liczbą całkowitą.', true); return; }
        if (!Number.isFinite(actionPointCost) || !Number.isInteger(actionPointCost)) { setStatus('Koszt Rzucenia w Punktach Akcji musi być liczbą całkowitą.', true); return; }
        if (!Number.isFinite(invocationCost) || !Number.isInteger(invocationCost)) { setStatus('Koszt Inwokacji musi być liczbą całkowitą.', true); return; }

        const spell = {
            ...makeDefaultSpell(), name, desc, schools, complexity, castingMethods,
            actionPointCost, invocationCost, channeling, requiresTransmutativeMaterial,
            otherPrerequisites, effects: draft.effects.map(e => ({ ...e, types: [...e.types] })),
        };

        if (channeling) {
            spell.channelingMethods = Array.from(rootEl.querySelectorAll('.se-chanmethod-cb:checked')).map(cb => cb.value);
            spell.channelingActionPointCost = Number(rootEl.querySelector('#se-chan-apcost').value) || 0;
            spell.channelingCost = Number(rootEl.querySelector('#se-chancost').value) || 0;
        }
        if (requiresTransmutativeMaterial) {
            spell.materialCost = Number(rootEl.querySelector('#se-materialcost').value) || 0;
        }

        const editingId = editingSpell ? editingSpell.id : null;
        try {
            let stored;
            if (!editingId) {
                stored = addCustomSpell(spell);
            } else if (isBuiltInSpellId(editingId)) {
                stored = updateBuiltInSpell(editingId, { ...spell, id: editingId });
            } else {
                stored = updateCustomSpell(editingId, { ...spell, id: editingId });
            }
            resetSpellEditor();
            setStatus(`${editingId ? 'Zapisano' : 'Utworzono'} "${stored.name}".`);
            if (typeof onSaved === 'function') onSaved(stored);
        } catch (e) {
            setStatus(e.message || 'Nie udało się zapisać zaklęcia.', true);
        }
    });

    // ---- Delete ---------------------------------------------------------
    const deleteBtn = rootEl.querySelector('#spell-editor-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!editingSpell) return;
            const id = editingSpell.id;
            const name = editingSpell.name;
            const builtIn = isBuiltInSpellId(id);
            const confirmMsg = builtIn
                ? `Usunąć zaklęcie wbudowane "${name}"? Plik spells.json pozostanie nietknięty; zaklęcie można przywrócić później.`
                : `Usunąć własne zaklęcie "${name}"? Tej operacji nie można cofnąć.`;
            if (!window.confirm(confirmMsg)) return;

            try {
                const ok = builtIn ? deleteBuiltInSpell(id) : removeCustomSpell(id);
                if (!ok) { setStatus('Nie udało się usunąć zaklęcia.', true); return; }
                resetSpellEditor();
                setStatus(`Usunięto "${name}".`);
                if (typeof onSaved === 'function') onSaved(null);
            } catch (e) {
                setStatus(e.message || 'Nie udało się usunąć zaklęcia.', true);
            }
        });
    }

    // ---- Export -----------------------------------------------------------
    rootEl.querySelector('#spell-editor-export-btn').addEventListener('click', () => {
        const data = { spells: getAllSpells() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spells.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus('Wyeksportowano spells.json — podmień nim plik w projekcie.');
    });
}

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
