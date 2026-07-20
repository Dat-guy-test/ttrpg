// ============================================================
// ARKANA  (Arkana tab)
//
// Builds the whole tab into #arcanaPage. Same render()/
// attachHandlers() pattern as characterSheet.js / equipmentSheet.js.
// Three subtabs, tracked in module-level `view.subTab`:
//
//   'known'      — "Znane zaklęcia": every spell the character
//                  currently knows (perk-granted, specific or by
//                  school+complexity — see spellState.js's
//                  getKnownSpells()). Read-only.
//   'compendium' — "Wielka Księga Zaklęć": browse every spell in the
//                  game, drill into one for full detail, and (via
//                  "Tryb Edycji") open the Magic Editor
//                  (spellEditor.js) to create/edit/delete spells.
//                  Same list/detail/edit three-page pattern as
//                  equipmentSheet.js.
//   'forging'    — "Wykuwanie zaklęć": reserved for future spell-
//                  crafting mechanics; placeholder for now.
//
// Exports:
//   initArcanaSheet()    — call once, after #arcanaPage exists.
//   refreshArcanaSheet() — full re-render; called by perkEffects.js
//                          whenever a perk's spell grant changes.
// ============================================================

import {
    getAllSpells, getSpellById, getCustomSpells, getKnownSpells, getSchoolGrants,
    isBuiltInSpellId, hasBuiltInOverride, resetBuiltInSpellOverride,
    getDeletedBuiltInSpells, restoreBuiltInSpell,
} from './spellState.js';
import { SPELL_SCHOOLS, CASTING_METHODS, SPELL_EFFECT_TYPES } from './spellSchema.js';
import { resetSpellEditor, renderSpellEditorHTML, wireSpellEditorHandlers } from './spellEditor.js';

let rootEl = null;

const view = {
    subTab: 'known',       // 'known' | 'compendium' | 'forging'
    compendiumPage: 'list', // 'list' | 'detail' | 'edit'
    selectedSpellId: null,
    editingSpellId: null,
};

function isCustomSpellId(id) {
    return getCustomSpells().some(s => s.id === id);
}

export function initArcanaSheet() {
    rootEl = document.getElementById('arcanaPage');
    if (!rootEl) {
        console.error('arcanaSheet: no #arcanaPage element found in the DOM.');
        return;
    }
    render();
}

export function refreshArcanaSheet() {
    if (rootEl) render();
}

function render() {
    rootEl.innerHTML = `
        <div class="arcanaSheet">
            <div class="arcanaSheet-subtabs">
                <button class="charBtn arcanaSubtab-btn ${view.subTab === 'known' ? 'active' : ''}" data-subtab="known">Znane zaklęcia</button>
                <button class="charBtn arcanaSubtab-btn ${view.subTab === 'compendium' ? 'active' : ''}" data-subtab="compendium">Wielka Księga Zaklęć</button>
                <button class="charBtn arcanaSubtab-btn ${view.subTab === 'forging' ? 'active' : ''}" data-subtab="forging">Wykuwanie zaklęć</button>
            </div>
            ${view.subTab === 'known' ? renderKnownSpellsPage()
                : view.subTab === 'compendium' ? renderCompendiumPage()
                : renderForgingPage()}
        </div>
    `;
    attachHandlers();
}

// ============================================================
// Shared spell-detail rendering (used by both Known Spells and Compendium detail)
// ============================================================

function labelOf(list, value) {
    const entry = list.find(o => o.value === value);
    return entry ? entry.label : value;
}

function renderSpellCard(spell, extraHtml = '') {
    const schools = (spell.schools || []).map(s => labelOf(SPELL_SCHOOLS, s)).join(', ') || '—';
    const castingMethods = (spell.castingMethods || []).map(m => labelOf(CASTING_METHODS, m)).join(', ') || '—';

    const channelingBlock = spell.channeling ? `
        <p class="equipDetail-category">Zaklęcie Podtrzymywane</p>
        <p>Sposób Podtrzymywania Zaklęcia: ${escapeHtml((spell.channelingMethods || []).map(m => labelOf(CASTING_METHODS, m)).join(', ') || '—')}</p>
        <p>Punkty Akcji Podtrzymywania Zaklęcia: ${spell.channelingActionPointCost ?? 0}</p>
        <p>Koszt Podtrzymywania: ${spell.channelingCost ?? 0}</p>
    ` : '';

    const materialBlock = spell.requiresTransmutativeMaterial ? `
        <p>Transmutuje Materiał — Koszt Materialny: ${spell.materialCost ?? 0}</p>
    ` : '';

    const prereqBlock = spell.otherPrerequisites ? `
        <p class="equipDetail-category">Inne Wymagania</p>
        <p>${escapeHtml(spell.otherPrerequisites)}</p>
    ` : '';

    const effectsBlock = (spell.effects && spell.effects.length > 0) ? `
        <p class="equipDetail-category">Efekty Zaklęcia</p>
        <ul>
            ${spell.effects.map(e => `
                <li>
                    <strong>${escapeHtml((e.types || []).map(t => labelOf(SPELL_EFFECT_TYPES, t)).join(', ') || '—')}</strong>
                    — Maksymalny Zasięg Ogniska: ${e.maxFocalRange ?? 0}
                    ${e.description ? `<br/>${escapeHtml(e.description)}` : ''}
                </li>
            `).join('')}
        </ul>
    ` : '';

    return `
        <div class="arcanaSpellCard">
            <h3 class="charSection-title">${escapeHtml(spell.name)}</h3>
            <p class="equipDetail-desc">${escapeHtml(spell.desc || '')}</p>
            <p class="equipDetail-category">Szkoła Magii: ${escapeHtml(schools)}</p>
            <p>Złożoność: ${spell.complexity ?? 0}</p>
            <p>Sposób Rzucania Zaklęcia: ${escapeHtml(castingMethods)}</p>
            <p>Koszt Rzucenia w Punktach Akcji: ${spell.actionPointCost ?? 0}</p>
            <p>Koszt Inwokacji: ${spell.invocationCost ?? 0}</p>
            ${channelingBlock}
            ${materialBlock}
            ${prereqBlock}
            ${effectsBlock}
            ${extraHtml}
        </div>
    `;
}

// ============================================================
// Subtab 1 — Znane zaklęcia
// ============================================================

function renderKnownSpellsPage() {
    const known = getKnownSpells();
    const grants = getSchoolGrants();

    const grantsHint = grants.length > 0 ? `
        <p class="charSection-hint">
            Aktywne odblokowania wg szkoły: ${grants.map(g =>
                `${g.schools.map(s => labelOf(SPELL_SCHOOLS, s)).join('/')} (maks. złożoność ${g.maxComplexity})`
            ).join('; ')}
        </p>
    ` : '';

    const body = known.length === 0
        ? '<p class="charSection-hint">Nie znasz jeszcze żadnych zaklęć — aktywuj odpowiednie perki w drzewku umiejętności.</p>'
        : known.map(spell => renderSpellCard(spell)).join('');

    return `
        <section class="charSection">
            <h2 class="charSection-title">Znane zaklęcia</h2>
            ${grantsHint}
            ${body}
        </section>
    `;
}

// ============================================================
// Subtab 2 — Wielka Księga Zaklęć  (list / detail / edit)
// ============================================================

function renderCompendiumPage() {
    if (view.compendiumPage === 'detail') return renderCompendiumDetailPage();
    if (view.compendiumPage === 'edit') return renderCompendiumEditPage();
    return renderCompendiumListPage();
}

function renderCompendiumListPage() {
    const spells = getAllSpells();
    const rows = spells.length === 0
        ? '<p class="charSection-hint">Brak zaklęć w bazie danych.</p>'
        : `<ul class="equipListRows">${spells.map(s => `
            <li class="equipListRow" data-open-spell="${escapeHtml(s.id)}">
                <span class="equipListRow-name">${escapeHtml(s.name)}</span>
                <span class="equipListRow-qty">Złożoność ${s.complexity ?? 0}</span>
            </li>
        `).join('')}</ul>`;

    return `
        <section class="charSection">
            <h2 class="charSection-title">Wielka Księga Zaklęć</h2>
            <div class="equipSheet-toolbar">
                <button class="charBtn" id="arcana-edit-toggle">Tryb Edycji</button>
            </div>
            ${rows}
        </section>
    `;
}

function renderCompendiumDetailPage() {
    const spell = getSpellById(view.selectedSpellId);
    if (!spell) {
        return `
            <section class="charSection">
                <p class="charSection-hint">Nie znaleziono zaklęcia.</p>
                <button class="charBtn" id="arcana-back-btn">Wróć do listy</button>
            </section>`;
    }
    const isEditable = isBuiltInSpellId(spell.id) || isCustomSpellId(spell.id);
    const isOverriddenBuiltIn = isBuiltInSpellId(spell.id) && hasBuiltInOverride(spell.id);

    const buttons = `
        <div class="equipSheet-toolbar" style="justify-content:flex-start;">
            ${isEditable ? `<button class="charBtn" id="arcana-edit-spell-btn">Edytuj zaklęcie</button>` : ''}
            ${isOverriddenBuiltIn ? `<button class="charBtn charBtn-danger" id="arcana-reset-override-btn">Przywróć oryginał</button>` : ''}
        </div>
    `;

    return `
        <section class="charSection">
            <button class="charBtn" id="arcana-back-btn">&larr; Wróć do listy</button>
            ${renderSpellCard(spell, buttons)}
        </section>
    `;
}

function renderCompendiumEditPage() {
    const customSpells = getCustomSpells();
    const builtInSpells = getAllSpells().filter(s => !isCustomSpellId(s.id));

    return `
        <div class="equipSheet-toolbar">
            <button class="charBtn" id="arcana-edit-back-btn">&larr; Wróć do listy</button>
        </div>
        <div class="editor-row" style="margin-bottom:1em;">
            <div style="flex:1;">
                <label class="charField-label" for="arcana-edit-spell-select">Edytowane zaklęcie</label>
                <select id="arcana-edit-spell-select">
                    <option value="">— Nowe zaklęcie —</option>
                    <optgroup label="Wbudowane (spells.json)">
                        ${builtInSpells.map(s => `
                            <option value="${escapeHtml(s.id)}" ${view.editingSpellId === s.id ? 'selected' : ''}>
                                ${escapeHtml(s.name)}${hasBuiltInOverride(s.id) ? ' (zmodyfikowane)' : ''}
                            </option>
                        `).join('')}
                    </optgroup>
                    <optgroup label="Własne">
                        ${customSpells.map(s => `<option value="${escapeHtml(s.id)}" ${view.editingSpellId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                    </optgroup>
                </select>
            </div>
        </div>
        ${renderDeletedSpellsSection()}
        ${renderSpellEditorHTML()}
    `;
}

function renderDeletedSpellsSection() {
    const deleted = getDeletedBuiltInSpells();
    if (deleted.length === 0) return '';
    return `
        <section class="charSection" style="margin-top:0.5em;">
            <h3 class="charSection-title">Usunięte zaklęcia (wbudowane)</h3>
            <ul class="equipListRows">
                ${deleted.map(s => `
                    <li class="equipListRow" style="cursor:default;">
                        <span class="equipListRow-name">${escapeHtml(s.name)}</span>
                        <button class="charBtn charBtn-small" data-restore-builtin-spell="${escapeHtml(s.id)}">Przywróć</button>
                    </li>
                `).join('')}
            </ul>
        </section>
    `;
}

// ============================================================
// Subtab 3 — Wykuwanie zaklęć  (placeholder)
// ============================================================

function renderForgingPage() {
    return `
        <section class="charSection">
            <h2 class="charSection-title">Wykuwanie zaklęć</h2>
            <p class="charSection-hint">Ta sekcja jest jeszcze w budowie.</p>
        </section>
    `;
}

// ============================================================
// Event wiring
// ============================================================

function attachHandlers() {
    rootEl.querySelectorAll('.arcanaSubtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            view.subTab = btn.dataset.subtab;
            render();
        });
    });

    if (view.subTab !== 'compendium') return;

    if (view.compendiumPage === 'list') {
        const editToggle = rootEl.querySelector('#arcana-edit-toggle');
        if (editToggle) editToggle.addEventListener('click', () => {
            view.editingSpellId = null;
            resetSpellEditor();
            view.compendiumPage = 'edit';
            render();
        });
        rootEl.querySelectorAll('[data-open-spell]').forEach(row => {
            row.addEventListener('click', () => {
                view.selectedSpellId = row.dataset.openSpell;
                view.compendiumPage = 'detail';
                render();
            });
        });
    } else if (view.compendiumPage === 'detail') {
        const backBtn = rootEl.querySelector('#arcana-back-btn');
        if (backBtn) backBtn.addEventListener('click', () => {
            view.compendiumPage = 'list';
            render();
        });
        const spell = getSpellById(view.selectedSpellId);
        if (spell) {
            const editBtn = rootEl.querySelector('#arcana-edit-spell-btn');
            if (editBtn) editBtn.addEventListener('click', () => {
                view.editingSpellId = spell.id;
                resetSpellEditor(spell);
                view.compendiumPage = 'edit';
                render();
            });
            const resetOverrideBtn = rootEl.querySelector('#arcana-reset-override-btn');
            if (resetOverrideBtn) resetOverrideBtn.addEventListener('click', () => {
                if (window.confirm(`Przywrócić oryginalną wersję "${spell.name}" ze spells.json?`)) {
                    resetBuiltInSpellOverride(spell.id);
                    render();
                }
            });
        }
    } else if (view.compendiumPage === 'edit') {
        rootEl.querySelector('#arcana-edit-back-btn').addEventListener('click', () => {
            view.editingSpellId = null;
            view.compendiumPage = 'list';
            render();
        });
        rootEl.querySelector('#arcana-edit-spell-select').addEventListener('change', (e) => {
            const id = e.target.value || null;
            view.editingSpellId = id;
            resetSpellEditor(id ? getSpellById(id) : null);
            render();
        });
        rootEl.querySelectorAll('[data-restore-builtin-spell]').forEach(btn => {
            btn.addEventListener('click', () => {
                restoreBuiltInSpell(btn.dataset.restoreBuiltinSpell);
                render();
            });
        });
        wireSpellEditorHandlers(rootEl, () => {
            view.editingSpellId = null;
            view.compendiumPage = 'list';
            render();
        });
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
