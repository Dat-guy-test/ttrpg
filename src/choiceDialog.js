// ============================================================
// CHOICE DIALOG
//
// Replaces the old window.prompt() "type a number" pickers that
// perkEffects.js used when a perk granted an 'attributeChoice' or a
// 'spellSchoolUnlock' effect. One modal, one list:
//
//   - the same search / filter / sort toolbar as the market (Rynek)
//     and the spell compendium (built from listControls.js). Filters
//     the perk itself requires — a spell grant's maximum complexity and
//     its allowed schools — are forced on and shown locked;
//   - a checkbox per row (exactly `count` must be ticked, so a perk that
//     needs 2 picks shows ONE dialog with "select 2" instead of two
//     dialogs in a row);
//   - a fragment of the item's description in a tooltip on hover (and an
//     "i" button that expands it inline, for touch screens);
//   - "Zrezygnuj z wybierania tego atrybutu" — closes the dialog and
//     reports `null`, which makes the caller NOT activate the perk.
//
// Exports (both return a Promise):
//   chooseAttributes({ nodeName, options, count }) → number[] | null
//       indexes into `options`, or null if the player backed out.
//   chooseSpells({ nodeName, spells, count, schools, maxComplexity }) → string[] | null
//       spell ids, or null if the player backed out.
//
// Imports only characterState.js / spellSchema.js / listControls.js, so
// perkEffects.js can import this without creating a cycle.
// ============================================================

import './choiceDialog.css';
import { ABILITIES_CONFIG, ATTRIBUTE_BONUS_KINDS } from './characterState.js';
import { SPELL_SCHOOLS, CASTING_METHODS } from './spellSchema.js';
import {
    renderFiltersHTML, wireFilterControls, parseBound, matchesText,
    sortWithComparators, compareNames, escapeHtml,
} from './listControls.js';

const CANCEL_LABEL = 'Zrezygnuj z wybierania tego atrybutu';
const PREVIEW_CHARS = 380;

// ---- small helpers ---------------------------------------------------------

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (n === 1) return one;
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
    return many;
}

function truncate(text, max = PREVIEW_CHARS) {
    const s = String(text ?? '').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

function labelOf(list, value) {
    const entry = list.find(o => o.value === value);
    return entry ? entry.label : value;
}

function bonusSummary(bonuses) {
    if (!Array.isArray(bonuses) || bonuses.length === 0) return '';
    return bonuses.map(b => {
        const ability = b.key ? ABILITIES_CONFIG.find(a => a.key === b.key) : null;
        const abilityLabel = b.key ? (ability ? ability.label : b.key) : 'dowolna umiejętność';
        const kind = ATTRIBUTE_BONUS_KINDS.find(k => k.value === b.kind);
        const sign = b.amount > 0 ? '+' : '';
        return `${sign}${b.amount} ${kind ? kind.label : b.kind} (${abilityLabel})`;
    }).join(', ');
}


// ============================================================
// Generic dialog
// ------------------------------------------------------------
// cfg = {
//   title, introHtml, lockedHint?,
//   items:      [{ id, index, name, meta, preview, searchText, data }],
//   count,      exact number of items that must be ticked
//   filterRows, filters,           — listControls.js toolbar + its state
//   predicate:  (item, filters, selectedSet) => boolean
//   comparators                    — for listControls.js's sortWithComparators()
// }
// Resolves to the ticked item ids (in `items` order), or null on cancel.
// ============================================================
function runDialog(cfg) {
    return new Promise((resolve) => {
        const { items, count, filters } = cfg;
        const selected = new Set();
        const byId = new Map(items.map(i => [i.id, i]));

        const overlay = document.createElement('div');
        overlay.className = 'choiceModal';
        overlay.innerHTML = `
            <div class="choicePanel" role="dialog" aria-modal="true" aria-labelledby="choicePanelTitle">
                <h2 class="choicePanel-title" id="choicePanelTitle">${escapeHtml(cfg.title)}</h2>
                <p class="choicePanel-intro">${cfg.introHtml}</p>
                ${cfg.lockedHint ? `<p class="choicePanel-locked">${escapeHtml(cfg.lockedHint)}</p>` : ''}
                ${renderFiltersHTML(cfg.filterRows, filters)}
                <p class="choicePanel-counter" id="choice-counter"></p>
                <div class="choiceList" id="choice-list"></div>
                <div class="choicePanel-footer">
                    <button type="button" class="charBtn charBtn-danger" id="choice-cancel">${escapeHtml(CANCEL_LABEL)}</button>
                    <button type="button" class="charBtn" id="choice-confirm" disabled>Potwierdź wybór</button>
                </div>
            </div>
            <div class="choiceTooltip" id="choice-tooltip" hidden></div>
        `;

        const listEl    = overlay.querySelector('#choice-list');
        const counterEl = overlay.querySelector('#choice-counter');
        const confirmEl = overlay.querySelector('#choice-confirm');
        const tipEl     = overlay.querySelector('#choice-tooltip');

        // ---- finishing --------------------------------------------------
        let closed = false;
        function close(result) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            resolve(result);
        }
        function onKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(null);
            }
        }
        document.addEventListener('keydown', onKeyDown, true);

        overlay.querySelector('#choice-cancel').addEventListener('click', () => close(null));
        confirmEl.addEventListener('click', () => {
            if (selected.size !== count) return;
            close(items.filter(i => selected.has(i.id)).map(i => i.id));
        });

        // ---- list rendering ------------------------------------------------
        function rowHTML(item) {
            return `
                <label class="choiceRow" data-id="${escapeHtml(item.id)}">
                    <input type="checkbox" value="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''} />
                    <span class="choiceRow-text">
                        <span class="choiceRow-name">${escapeHtml(item.name)}</span>
                        ${item.meta ? `<span class="choiceRow-meta">${escapeHtml(item.meta)}</span>` : ''}
                        <span class="choiceRow-desc" hidden>${escapeHtml(item.preview)}</span>
                    </span>
                    <button type="button" class="choiceRow-info" title="Pokaż fragment opisu" aria-label="Pokaż fragment opisu">i</button>
                </label>
            `;
        }

        // Only the list is re-rendered when a filter changes — the toolbar
        // itself stays put, so typing in the search box never loses focus.
        function renderList() {
            const visible = sortWithComparators(
                items.filter(i => cfg.predicate(i, filters, selected)),
                filters.sortBy,
                cfg.comparators
            );
            listEl.innerHTML = visible.length === 0
                ? '<p class="charSection-hint">Brak pozycji pasujących do wyszukiwania/filtrów.</p>'
                : visible.map(rowHTML).join('');
            hideTip();
            syncControls();
        }

        function syncControls() {
            const full = selected.size >= count;
            counterEl.textContent = `Wybrano: ${selected.size} / ${count} (dostępnych pozycji: ${items.length})`;
            confirmEl.disabled = selected.size !== count;
            // With several picks required, lock the unticked boxes once the quota is full.
            // (With a single pick, ticking another row simply moves the choice — see below.)
            listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.disabled = count > 1 && full && !cb.checked;
            });
        }

        listEl.addEventListener('change', (e) => {
            const cb = e.target;
            if (!cb || cb.type !== 'checkbox') return;
            if (cb.checked) {
                if (count === 1) {
                    selected.clear();
                    listEl.querySelectorAll('input[type="checkbox"]').forEach(other => { if (other !== cb) other.checked = false; });
                }
                if (selected.size < count) selected.add(cb.value);
                else cb.checked = false;
            } else {
                selected.delete(cb.value);
            }
            syncControls();
        });

        // ---- description: inline toggle ("i" button) -----------------------------
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.choiceRow-info');
            if (!btn) return;
            e.preventDefault();   // the button sits inside a <label> — don't toggle the checkbox
            e.stopPropagation();
            const desc = btn.closest('.choiceRow').querySelector('.choiceRow-desc');
            if (desc) desc.hidden = !desc.hidden;
        });

        // ---- description: hover tooltip --------------------------------------------
        let tipId = null;
        function hideTip() { tipEl.hidden = true; tipId = null; }
        function positionTip(e) {
            const pad = 16;
            const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
            let x = e.clientX + pad;
            let y = e.clientY + pad;
            if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
            if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
            tipEl.style.left = `${Math.max(8, x)}px`;
            tipEl.style.top  = `${Math.max(8, y)}px`;
        }
        listEl.addEventListener('mousemove', (e) => {
            const row = e.target.closest('.choiceRow');
            if (!row) { hideTip(); return; }
            const item = byId.get(row.dataset.id);
            if (!item || !item.preview) { hideTip(); return; }
            if (tipId !== item.id) {
                tipEl.textContent = item.preview;
                tipId = item.id;
            }
            tipEl.hidden = false;
            positionTip(e);
        });
        listEl.addEventListener('mouseleave', hideTip);
        listEl.addEventListener('scroll', hideTip);

        // ---- filters ------------------------------------------------------------------
        wireFilterControls(overlay, cfg.filterRows, filters, renderList);

        document.body.appendChild(overlay);
        renderList();
        const search = overlay.querySelector('input[type="text"]');
        if (search) search.focus();
    });
}


// ============================================================
// Attribute picker  ("Atrybut do Wyboru")
// ============================================================

const ATTRIBUTE_COMPARATORS = {
    original: (a, b) => a.index - b.index,
    nameDesc: (a, b) => compareNames(b.name, a.name),
};

/**
 * @param {{nodeName:string, options:{name:string, description?:string, bonuses?:object[]}[], count:number}} p
 * @returns {Promise<number[]|null>} chosen option indexes, or null if the player gave up
 */
export function chooseAttributes({ nodeName, options, count }) {
    const need = Math.max(1, Math.min(Number(count) || 1, options.length));

    const items = options.map((o, i) => ({
        id: String(i),
        index: i,
        name: o.name,
        meta: bonusSummary(o.bonuses),
        preview: truncate(o.description || ''),
        searchText: `${o.name}\n${o.description || ''}`,
    }));

    const filterRows = [
        [
            { type: 'text', id: 'choice-search', key: 'search', placeholder: 'Szukaj atrybutu po nazwie…', flex: 2 },
            { type: 'checkbox', id: 'choice-searchdesc', key: 'searchDesc', label: 'Szukaj też w opisie' },
            { type: 'checkbox', id: 'choice-selectedonly', key: 'selectedOnly', label: 'Tylko zaznaczone' },
        ],
        [
            { type: 'select', id: 'choice-sort', key: 'sortBy', label: 'Sortuj wg:', options: [
                { value: 'original', label: 'Kolejności w perku' },
                { value: 'name', label: 'Nazwy (A-Z)' },
                { value: 'nameDesc', label: 'Nazwy (Z-A)' },
            ] },
        ],
    ];

    return runDialog({
        title: `Wybór atrybutu — ${nodeName}`,
        introHtml: `Zaznacz <strong>${need} ${plural(need, 'atrybut', 'atrybuty', 'atrybutów')}</strong> z poniższej listy. `
            + 'Najedź kursorem na pozycję, by zobaczyć fragment opisu.',
        items,
        count: need,
        filters: { search: '', searchDesc: false, selectedOnly: false, sortBy: 'original' },
        filterRows,
        comparators: ATTRIBUTE_COMPARATORS,
        predicate: (item, f, selected) => {
            if (!matchesText(f.searchDesc ? item.searchText : item.name, f.search)) return false;
            if (f.selectedOnly && !selected.has(item.id)) return false;
            return true;
        },
    }).then(ids => (ids === null ? null : ids.map(Number)));
}


// ============================================================
// Spell picker  ("Odblokuj Zaklęcia wg Szkoły")
// ============================================================

const num = (v) => Number(v) || 0;
const spellCmp = (field, dir) => (a, b) => dir * (num(a.data[field]) - num(b.data[field]));

const SPELL_COMPARATORS = {
    complexityAsc:  spellCmp('complexity', 1),
    complexityDesc: spellCmp('complexity', -1),
    apAsc:          spellCmp('actionPointCost', 1),
    apDesc:         spellCmp('actionPointCost', -1),
    invocationAsc:  spellCmp('invocationCost', 1),
    invocationDesc: spellCmp('invocationCost', -1),
};

const yesNoOptions = (any, yes, no) => [
    { value: '', label: any }, { value: 'yes', label: yes }, { value: 'no', label: no },
];

/**
 * @param {{nodeName:string, spells:object[], count:number, schools:string[], maxComplexity:number}} p
 *   `spells` is the already-eligible pool (see spellState.js's getEligibleSpellsForSchoolGrant()).
 * @returns {Promise<string[]|null>} chosen spell ids, or null if the player gave up
 */
export function chooseSpells({ nodeName, spells, count, schools, maxComplexity }) {
    const need = Math.max(1, Math.min(Number(count) || 1, spells.length));
    const allowedSchools = Array.isArray(schools) ? schools : [];
    const schoolLabels = allowedSchools.map(s => labelOf(SPELL_SCHOOLS, s));

    const items = spells.map((s, i) => {
        const spellSchools = (s.schools || []).map(x => labelOf(SPELL_SCHOOLS, x)).join(', ') || '—';
        return {
            id: s.id,
            index: i,
            name: s.name,
            meta: `Złożoność ${s.complexity ?? 0} · PA ${s.actionPointCost ?? 0} · Inwokacja ${s.invocationCost ?? 0} · ${spellSchools}`,
            preview: truncate(s.desc || ''),
            searchText: `${s.name}\n${s.desc || ''}`,
            data: s,
        };
    });

    const filterRows = [
        [
            { type: 'text', id: 'choice-search', key: 'search', placeholder: 'Szukaj zaklęcia po nazwie…', flex: 2 },
            { type: 'checkbox', id: 'choice-searchdesc', key: 'searchDesc', label: 'Szukaj też w opisie' },
            { type: 'checkbox', id: 'choice-selectedonly', key: 'selectedOnly', label: 'Tylko zaznaczone' },
        ],
        [
            { type: 'select', id: 'choice-school', key: 'school', flex: 1, options: [
                { value: '', label: allowedSchools.length > 1 ? '— Wszystkie dozwolone szkoły —' : '— Dozwolona szkoła —' },
                ...allowedSchools.map(s => ({ value: s, label: labelOf(SPELL_SCHOOLS, s) })),
            ] },
            { type: 'select', id: 'choice-casting', key: 'casting', flex: 1, options: [
                { value: '', label: '— Dowolny sposób rzucania —' },
                ...CASTING_METHODS.map(m => ({ value: m.value, label: m.label })),
            ] },
        ],
        [
            { type: 'number', id: 'choice-complexity-min', key: 'complexityMin', placeholder: 'Złożoność min.', attrs: 'min="0" step="1"' },
            // Forced by the perk: this one is locked, the player can't raise it.
            { type: 'number', id: 'choice-complexity-max', key: 'complexityMax', placeholder: 'Złożoność maks.', attrs: 'disabled title="Wymuszone przez ten perk"' },
            { type: 'number', id: 'choice-ap-min', key: 'apMin', placeholder: 'Punkty Akcji min.', attrs: 'min="0" step="1"' },
            { type: 'number', id: 'choice-ap-max', key: 'apMax', placeholder: 'Punkty Akcji maks.', attrs: 'min="0" step="1"' },
        ],
        [
            { type: 'select', id: 'choice-channeling', key: 'channeling', flex: 1,
                options: yesNoOptions('— Podtrzymywane: dowolnie —', 'Tylko podtrzymywane', 'Tylko niepodtrzymywane') },
            { type: 'select', id: 'choice-material', key: 'material', flex: 1,
                options: yesNoOptions('— Materiał: dowolnie —', 'Transmutują materiał', 'Nie transmutują materiału') },
        ],
        [
            { type: 'select', id: 'choice-sort', key: 'sortBy', label: 'Sortuj wg:', options: [
                { value: 'name', label: 'Nazwy (A-Z)' },
                { value: 'complexityAsc', label: 'Złożoności (rosnąco)' },
                { value: 'complexityDesc', label: 'Złożoności (malejąco)' },
                { value: 'apAsc', label: 'Kosztu w PA (rosnąco)' },
                { value: 'apDesc', label: 'Kosztu w PA (malejąco)' },
                { value: 'invocationAsc', label: 'Kosztu Inwokacji (rosnąco)' },
                { value: 'invocationDesc', label: 'Kosztu Inwokacji (malejąco)' },
            ] },
        ],
    ];

    return runDialog({
        title: `Wybór zaklęcia — ${nodeName}`,
        introHtml: `Zaznacz <strong>${need} ${plural(need, 'zaklęcie', 'zaklęcia', 'zaklęć')}</strong> z poniższej listy. `
            + 'Najedź kursorem na pozycję, by zobaczyć fragment opisu.',
        lockedHint: `Wymuszone przez perk: maksymalna złożoność ${num(maxComplexity)}`
            + (schoolLabels.length ? `; dozwolone szkoły: ${schoolLabels.join(', ')}.` : '.'),
        items,
        count: need,
        filters: {
            search: '', searchDesc: false, selectedOnly: false,
            school: '', casting: '',
            complexityMin: '', complexityMax: String(num(maxComplexity)),
            apMin: '', apMax: '',
            channeling: '', material: '',
            sortBy: 'name',
        },
        filterRows,
        comparators: SPELL_COMPARATORS,
        predicate: (item, f, selected) => {
            const s = item.data;
            if (!matchesText(f.searchDesc ? item.searchText : item.name, f.search)) return false;
            if (f.selectedOnly && !selected.has(item.id)) return false;
            if (f.school && !(s.schools || []).includes(f.school)) return false;
            if (f.casting && !(s.castingMethods || []).includes(f.casting)) return false;

            const complexity = num(s.complexity);
            const cMin = parseBound(f.complexityMin), cMax = parseBound(f.complexityMax);
            if (cMin !== null && complexity < cMin) return false;
            if (cMax !== null && complexity > cMax) return false;

            const ap = num(s.actionPointCost);
            const aMin = parseBound(f.apMin), aMax = parseBound(f.apMax);
            if (aMin !== null && ap < aMin) return false;
            if (aMax !== null && ap > aMax) return false;

            if (f.channeling === 'yes' && !s.channeling) return false;
            if (f.channeling === 'no'  &&  s.channeling) return false;
            if (f.material === 'yes' && !s.requiresTransmutativeMaterial) return false;
            if (f.material === 'no'  &&  s.requiresTransmutativeMaterial) return false;
            return true;
        },
    });
}
