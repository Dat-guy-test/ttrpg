// ============================================================
// ITEM EDITOR  (Equipment tab → "Tryb Edycji")
//
// Builds the form used to create brand-new custom items with the
// full extended schema described in itemSchema.js. Mirrors
// editMode.js's approach for the skill tree:
//
//   - Every type-specific section is rendered into the DOM up front;
//     changing "Typ" only toggles which sections are VISIBLE (see
//     updateTypeSectionVisibility()) instead of re-rendering the
//     whole form — so switching types never wipes out base fields
//     (Nazwa, Opis, …) the player already typed.
//
//   - Three sub-lists need dynamic add/remove UI instead of a single
//     input: Wymagania (skill+min pairs), Ulepszenia (free-text
//     strings) and Tryby Ataku (nested attack-mode objects, each
//     with its own Obrażenia sub-list). These live in a module-level
//     `draft` and each has its own small re-rendered container — the
//     same "renderPendingEffectsList() only touches its own div"
//     pattern editMode.js already uses for a node's staged effects.
//
// The Set flag/members list (Zestaw) applies to every item type, so
// it's rendered once, above the type-specific sections, instead of
// being part of the Armour-family block.
//
// Editing: resetItemEditor(existingItem) loads an existing item into
// the form — every scalar field's HTML is generated from the current
// `editingItem`, so re-opening the editor with an item pre-fills
// everything. This now works for BOTH kinds of existing item:
//   - a player-created CUSTOM item        → saved via updateCustomItem()
//   - an EXISTING items.json (built-in) item → saved via
//     updateBuiltInItem(), which stores an edited copy as an
//     "override" rather than mutating items.json itself (see
//     equipmentState.js's "BUILT-IN ITEM OVERRIDES" section). Which
//     path is used is decided at save time purely by asking
//     isBuiltInItemId(editingId) — the form itself doesn't need to
//     know or care which kind of existing item it's editing.
//
// Exports:
//   resetItemEditor(existingItem?)         — clears/loads the form;
//                                            call whenever Tryb
//                                            Edycji is (re)opened,
//                                            passing an existing
//                                            item (built-in or
//                                            custom) to edit it.
//   renderItemEditorHTML()                 — returns the form's HTML.
//   wireItemEditorHandlers(rootEl, onSaved)
//                                          — attaches every listener.
//                                            onSaved(storedItem) is
//                                            called after a
//                                            successful create/save.
// ============================================================

import {
    ITEM_TYPES, ITEM_STATES, WEAPON_KINDS, ATTACK_MODE_TYPES,
    HANDEDNESS_OPTIONS, DAMAGE_DICE, DAMAGE_TYPES, EQUIP_SLOTS, EQUIP_LAYERS,
    EQUIP_REQUIREMENT_SKILLS, typeUsesArmourFields, makeDefaultItem,
} from './itemSchema.js';
import {
    addCustomItem, updateCustomItem, removeCustomItem, getAllItems, getItemById,
    isBuiltInItemId, updateBuiltInItem, isBuiltInItemDeleted, deleteBuiltInItem,
    NOT_FOR_SALE, isNotForSale, normalizeSetMembers,
} from './equipmentState.js';

let draft = null;         // { requirements: [], upgrades: [], attackModes: [] }
let pendingDamage = [];   // Obrażenia entries staged for the attack-mode-in-progress mini-form
let editingItem = null;   // the item (built-in OR custom) currently being edited, or null when creating a brand-new one

/**
 * Resets the form. Pass an existing item (built-in or custom) to
 * load it for editing (its Wymagania/Ulepszenia/Tryby Ataku go into
 * `draft`, and every other field is read straight off `editingItem`
 * by the HTML renderers below); call with no argument to start a
 * fresh item.
 * @param {object} [existingItem]
 */
export function resetItemEditor(existingItem) {
    editingItem = existingItem || null;
    draft = {
        requirements: existingItem && Array.isArray(existingItem.requirements)
            ? existingItem.requirements.map(r => ({ ...r })) : [],
        upgrades: existingItem && Array.isArray(existingItem.upgrades)
            ? [...existingItem.upgrades] : [],
        // {itemId, quantity}[] — normalizeSetMembers() also accepts the
        // older plain-id-string shape, so a set saved before this
        // feature loads in cleanly instead of needing a manual fixup.
        setMembers: existingItem ? normalizeSetMembers(existingItem.setMembers) : [],
        attackModes: existingItem && Array.isArray(existingItem.attackModes)
            ? existingItem.attackModes.map(m => ({
                ...m,
                damage: (m.damage || []).map(d => ({ ...d })),
                spread: m.spread ? { ...m.spread } : null,
            }))
            : [],
    };
    pendingDamage = [];
}
resetItemEditor();


// ============================================================
// Top-level HTML
// ============================================================
export function renderItemEditorHTML() {
    const editingBuiltIn = !!(editingItem && isBuiltInItemId(editingItem.id));
    const titleSuffix = editingBuiltIn ? ' (przedmiot wbudowany)' : '';
    return `
        <section class="charSection">
            <h2 class="charSection-title">${editingItem ? `Edytuj: ${escapeHtml(editingItem.name)}${titleSuffix}` : 'Nowy Przedmiot'}</h2>
            ${editingBuiltIn ? `<p class="charSection-hint">To przedmiot wbudowany (items.json). Zapis nie nadpisuje pliku — tworzy lokalne nadpisanie (override), które ma pierwszeństwo wszędzie w grze, dopóki nie wyeksportujesz items.json i nie podmienisz nim pliku w projekcie, lub nie klikniesz "Przywróć oryginał" na stronie szczegółów przedmiotu.</p>` : ''}
            <div id="item-editor-status" class="editor-status"></div>

            ${baseFieldsHTML()}
            ${setSectionHTML()}

            <div id="item-editor-requirements-section" class="itemEditor-typeSection">
                <label class="charField-label">Wymagania (Umiejętności)</label>
                <div id="item-editor-requirements-list">${renderRequirementsList()}</div>
                <div class="editor-row">
                    <select id="ie-req-skill">
                        ${EQUIP_REQUIREMENT_SKILLS.map(s => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join('')}
                    </select>
                    <input id="ie-req-min" type="number" step="1" value="1" placeholder="Min" />
                    <button class="editor-btn editor-btn-small" id="ie-req-add-btn">Dodaj</button>
                </div>
            </div>

            <div id="item-editor-type-weapon" class="itemEditor-typeSection">${weaponFieldsHTML()}</div>
            <div id="item-editor-type-armourfamily" class="itemEditor-typeSection">${armourFieldsHTML()}</div>
            <div id="item-editor-type-utility" class="itemEditor-typeSection">${utilityFieldsHTML()}</div>

            <div class="editor-row" style="margin-top:1em;">
                <button class="charBtn editor-save-btn" id="item-editor-create-btn">${editingItem ? 'Zapisz Zmiany' : 'Utwórz Przedmiot'}</button>
                ${editingItem ? `<button class="charBtn charBtn-danger" id="item-editor-delete-btn">Usuń przedmiot</button>` : ''}
            </div>
            <div class="editor-row">
                <button class="charBtn" id="item-editor-export-btn">Eksportuj items.json (wbudowane + własne)</button>
            </div>
            <p class="charSection-hint">Nowe/edytowane przedmioty są zapisywane lokalnie i widoczne od razu w grze. Przycisk eksportu łączy wbudowane przedmioty — wraz z ich ewentualnymi nadpisaniami — (items.json) z własnymi (Tryb Edycji) w jeden gotowy plik items.json — wystarczy nim podmienić plik w projekcie, bez ręcznego wklejania.</p>
        </section>
    `;
}

/** The Set flag/members list — applies to every item type, so it lives outside the type-specific sections. */
function setSectionHTML() {
    const it = editingItem;
    const isSet = !!(it && it.isSet);
    return `
        <div id="item-editor-set-section" class="itemEditor-typeSection">
            <label><input type="checkbox" id="ie-isset" ${isSet ? 'checked' : ''} /> Zestaw</label>
            <div id="item-editor-setmembers-wrap" style="display:${isSet ? '' : 'none'};">
                <label class="charField-label">Elementy zestawu</label>
                <div id="item-editor-setmembers-list">${renderSetMembersList()}</div>
                <div class="editor-row">
                    <select id="ie-setmember-select">${renderSetMemberOptions()}</select>
                    <input id="ie-setmember-qty" type="number" min="1" step="1" value="1" style="max-width:5em;" />
                    <button class="editor-btn editor-btn-small" id="ie-setmember-add-btn">Dodaj</button>
                </div>
                <p class="charSection-hint">Wybierz spośród wszystkich znanych przedmiotów (wbudowanych i własnych), na które ten zestaw się "rozkłada". Ten sam przedmiot można dodać wielokrotnie — ilości się sumują, więc zestaw może zawierać np. dwie takie same strzały.</p>
            </div>
        </div>
    `;
}

/** Dropdown options for picking a set-member item — every known item (built-in + custom) except (if editing) the one being edited itself. */
function renderSetMemberOptions() {
    const items = getAllItems().filter(i => !editingItem || i.id !== editingItem.id);
    if (items.length === 0) return '<option value="">Brak dostępnych przedmiotów</option>';
    return items.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join('');
}

/** Current staged set-members (draft.setMembers), each shown as "Nx Name" with a remove button. */
function renderSetMembersList() {
    if (draft.setMembers.length === 0) return '<em>Brak elementów zestawu.</em>';
    return draft.setMembers.map((m, i) => {
        const member = getItemById(m.itemId);
        return `<div class="editor-req-row">
            <span>${m.quantity}x ${escapeHtml(member ? member.name : m.itemId)}</span>
            <button class="editor-btn editor-btn-small" data-remove-setmember="${i}">✕</button>
        </div>`;
    }).join('');
}

function baseFieldsHTML() {
    const it = editingItem;
    return `
        <label class="charField-label" for="ie-name">Nazwa</label>
        <input id="ie-name" type="text" value="${escapeHtml(it?.name || '')}" />

        <label class="charField-label" for="ie-type">Typ</label>
        <select id="ie-type">
            ${ITEM_TYPES.map(t => `<option value="${t.value}" ${it && it.type === t.value ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
        </select>

        <div class="editor-row">
            <div>
                <label class="charField-label" for="ie-price">Cena (Nitki Konstancjum)</label>
                <input id="ie-price" type="number" min="0" step="1" value="${isNotForSale(it?.price) ? 0 : (it?.price ?? 0)}" ${isNotForSale(it?.price) ? 'disabled' : ''} />
                <label><input type="checkbox" id="ie-notforsale" ${isNotForSale(it?.price) ? 'checked' : ''} /> Nie Sprzedawany</label>
            </div>
            <div>
                <label class="charField-label" for="ie-bulk">Obciążenie</label>
                <input id="ie-bulk" type="number" min="0" step="0.1" value="${it?.bulk ?? 0}" />
            </div>
        </div>

        <div class="editor-row">
            <div>
                <label class="charField-label" for="ie-state">Stan</label>
                <select id="ie-state">
                    ${ITEM_STATES.map(s => `<option value="${s.value}" ${it && it.state === s.value ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
                </select>
            </div>
            <div>
                <label class="charField-label" for="ie-hp">Wytrzymałość</label>
                <input id="ie-hp" type="number" min="1" step="1" value="${it?.hitPoints ?? 1}" />
            </div>
            <div>
                <label class="charField-label" for="ie-toughness">Twardość</label>
                <input id="ie-toughness" type="number" step="1" value="${it?.toughness ?? 0}" />
            </div>
        </div>

        <label class="charField-label" for="ie-desc">Opis</label>
        <textarea id="ie-desc" rows="3">${escapeHtml(it?.desc || '')}</textarea>
    `;
}

function weaponFieldsHTML() {
    const it = editingItem;
    const kinds = new Set((it && it.weaponKinds) || []);
    return `
        <h3 class="charSection-title">Broń</h3>
        <div class="editor-row">
            <div>
                <label class="charField-label" for="ie-block">Blokowanie</label>
                <input id="ie-block" type="number" step="1" value="${it?.block ?? 0}" />
            </div>
            <div>
                <label class="charField-label" for="ie-deflection">Odbicie</label>
                <input id="ie-deflection" type="number" step="1" value="${it?.deflection ?? 0}" />
            </div>
        </div>

        <label class="charField-label">Typ broni</label>
        <div class="editor-checkboxGroup">
            ${WEAPON_KINDS.map(k => `
                <label><input type="checkbox" class="ie-weaponkind-cb" value="${k.value}" ${kinds.has(k.value) ? 'checked' : ''} /> ${escapeHtml(k.label)}</label>
            `).join('')}
        </div>

        <label class="charField-label" for="ie-proficiency">Kategoria Wprawy</label>
        <input id="ie-proficiency" type="text" value="${escapeHtml(it?.proficiencyCategory || '')}" />

        <label class="charField-label">Ulepszenia</label>
        <div id="item-editor-upgrades-list">${renderUpgradesList()}</div>
        <div class="editor-row">
            <input id="ie-upgrade-text" type="text" placeholder="Nazwa ulepszenia…" />
            <button class="editor-btn editor-btn-small" id="ie-upgrade-add-btn">Dodaj</button>
        </div>

        ${attackModeFormHTML()}
    `;
}

function attackModeFormHTML() {
    return `
        <label class="charField-label">Tryby Ataku</label>
        <div id="item-editor-atkmodes-list">${renderAttackModesList()}</div>

        <div class="itemEditor-subform">
            <label class="charField-label" for="ie-atk-name">Nazwa trybu</label>
            <input id="ie-atk-name" type="text" />

            <div class="editor-row">
                <div>
                    <label class="charField-label" for="ie-atk-modetype">Typ Trybu</label>
                    <select id="ie-atk-modetype">
                        ${ATTACK_MODE_TYPES.map(t => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="charField-label" for="ie-atk-hand">Rodzaj Ataku</label>
                    <select id="ie-atk-hand">
                        ${HANDEDNESS_OPTIONS.map(h => `<option value="${h.value}">${escapeHtml(h.label)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div class="editor-row">
                <div>
                    <label class="charField-label" for="ie-atk-acc">Podstawowa Celność</label>
                    <input id="ie-atk-acc" type="number" step="1" value="0" />
                </div>
                <div>
                    <label class="charField-label" for="ie-atk-minrange">Minimalny Zasięg</label>
                    <input id="ie-atk-minrange" type="number" step="1" value="0" />
                </div>
                <div>
                    <label class="charField-label" for="ie-atk-maxrange">Maksymalny Zasięg</label>
                    <input id="ie-atk-maxrange" type="number" step="1" value="0" />
                </div>
            </div>

            <label class="charField-label">Obrażenia</label>
            <div id="item-editor-atkdamage-list">${renderPendingDamageList()}</div>
            <div class="editor-row">
                <input id="ie-dmg-count" type="number" min="1" step="1" value="1" style="max-width:4em;" />
                <select id="ie-dmg-dice">${DAMAGE_DICE.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
                <input id="ie-dmg-mod" type="number" step="1" value="0" placeholder="Mod." style="max-width:5em;" />
                <select id="ie-dmg-type">${DAMAGE_TYPES.map(t => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}</select>
                <button class="editor-btn editor-btn-small" id="ie-dmg-add-btn">Dodaj</button>
            </div>

            <div id="item-editor-atk-spread-wrap" style="display:none;">
                <label class="charField-label">Rozrzut</label>
                <div class="editor-row">
                    <input id="ie-atk-spread-count" type="number" min="1" step="1" value="1" style="max-width:4em;" />
                    <select id="ie-atk-spread-dice">${DAMAGE_DICE.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
                    <input id="ie-atk-spread-mod" type="number" step="1" value="0" placeholder="Mod." />
                </div>

                <label class="charField-label" for="ie-atk-effrange">Efektywny Zasięg</label>
                <input id="ie-atk-effrange" type="number" min="1" step="1" value="1" />
            </div>

            <label class="charField-label" for="ie-atk-special">Efekt Specjalny</label>
            <textarea id="ie-atk-special" rows="2"></textarea>

            <button class="editor-btn editor-btn-small" id="ie-atk-add-btn">Dodaj Tryb Ataku</button>
        </div>
    `;
}

function armourFieldsHTML() {
    const it = editingItem;
    const slots = new Set((it && it.equipSlots) || []);
    const layers = new Set((it && it.equipLayers) || []);
    return `
        <h3 class="charSection-title">Pancerz / Ubrania / Schowek</h3>

        <div id="item-editor-armourlevel-wrap">
            <label class="charField-label" for="ie-armourlevel">Poziom Pancerza</label>
            <input id="ie-armourlevel" type="number" min="1" step="1" value="${it?.armourLevel ?? 1}" />
        </div>

        <label class="charField-label">Miejsce Wyposażenia</label>
        <div class="editor-checkboxGroup">
            ${EQUIP_SLOTS.map(s => `
                <label><input type="checkbox" class="ie-slot-cb" value="${s.value}" ${slots.has(s.value) ? 'checked' : ''} /> ${escapeHtml(s.label)}</label>
            `).join('')}
        </div>

        <label class="charField-label">Warstwa</label>
        <div class="editor-checkboxGroup">
            ${EQUIP_LAYERS.map(l => `
                <label><input type="checkbox" class="ie-layer-cb" value="${l.value}" ${layers.has(l.value) ? 'checked' : ''} /> ${escapeHtml(l.label)}</label>
            `).join('')}
        </div>

        <label class="charField-label" id="ie-effectdesc-label" for="ie-effectdesc">${it && it.isSet ? 'Efekt Zestawu Pancerza' : 'Efekt Części Pancerza'}</label>
        <textarea id="ie-effectdesc" rows="3">${escapeHtml(it?.effectDescription || '')}</textarea>

        <div class="editor-row">
            <div>
                <label class="charField-label" for="ie-equip-sec">Czas Wyposażania (s)</label>
                <input id="ie-equip-sec" type="number" min="0" step="1" value="${it?.equipTimeSeconds ?? 0}" />
            </div>
            <div>
                <label class="charField-label" for="ie-equip-ap">Czas Wyposażania (PA)</label>
                <input id="ie-equip-ap" type="number" min="0" step="1" value="${it?.equipTimeActionPoints ?? 0}" />
            </div>
        </div>
        <div class="editor-row">
            <div>
                <label class="charField-label" for="ie-unequip-sec">Czas Zdejmowania (s)</label>
                <input id="ie-unequip-sec" type="number" min="0" step="1" value="${it?.unequipTimeSeconds ?? 0}" />
            </div>
            <div>
                <label class="charField-label" for="ie-unequip-ap">Czas Zdejmowania (PA)</label>
                <input id="ie-unequip-ap" type="number" min="0" step="1" value="${it?.unequipTimeActionPoints ?? 0}" />
            </div>
        </div>

        <div id="item-editor-capacity-wrap" style="display:none;">
            <label class="charField-label" for="ie-capacity">Pojemność</label>
            <input id="ie-capacity" type="number" min="0" step="0.1" value="${it?.capacity ?? 0}" />
        </div>
    `;
}

function utilityFieldsHTML() {
    const it = editingItem;
    return `
        <h3 class="charSection-title">Użytkowy</h3>
        <label class="charField-label" for="ie-usecond">Warunek Użycia</label>
        <textarea id="ie-usecond" rows="2">${escapeHtml(it?.useCondition || '')}</textarea>
        <label class="charField-label" for="ie-useeffect">Efekt Użycia</label>
        <textarea id="ie-useeffect" rows="2">${escapeHtml(it?.useEffect || '')}</textarea>
    `;
}


// ============================================================
// Dynamic list rendering (Wymagania / Ulepszenia / Tryby Ataku / staged Obrażenia)
// ============================================================

function renderRequirementsList() {
    if (draft.requirements.length === 0) return '<em>Brak wymagań.</em>';
    return draft.requirements.map((r, i) => {
        const cfg = EQUIP_REQUIREMENT_SKILLS.find(s => s.key === r.skill);
        return `<div class="editor-req-row">
            <span>${escapeHtml(cfg ? cfg.label : r.skill)} ≥ ${r.min}</span>
            <button class="editor-btn editor-btn-small" data-remove-req="${i}">✕</button>
        </div>`;
    }).join('');
}

function renderUpgradesList() {
    if (draft.upgrades.length === 0) return '<em>Brak ulepszeń.</em>';
    return draft.upgrades.map((u, i) => `
        <div class="editor-req-row">
            <span>${escapeHtml(u)}</span>
            <button class="editor-btn editor-btn-small" data-remove-upgrade="${i}">✕</button>
        </div>
    `).join('');
}

function describeDiceModifier(d) {
    const sign = d.modifier > 0 ? '+' : '';
    const modPart = d.modifier ? `${sign}${d.modifier}` : '';
    return `${d.count}${d.dice}${modPart}`;
}

function describeDamageEntry(d) {
    const typeLabel = (DAMAGE_TYPES.find(t => t.value === d.type) || {}).label || d.type;
    return `${describeDiceModifier(d)} (${typeLabel})`;
}

function renderPendingDamageList() {
    if (pendingDamage.length === 0) return '<em>Brak dodanych obrażeń.</em>';
    return pendingDamage.map((d, i) => `
        <div class="editor-req-row">
            <span>${escapeHtml(describeDamageEntry(d))}</span>
            <button class="editor-btn editor-btn-small" data-remove-dmg="${i}">✕</button>
        </div>
    `).join('');
}

function renderAttackModesList() {
    if (draft.attackModes.length === 0) return '<em>Brak trybów ataku.</em>';
    return draft.attackModes.map((m, i) => {
        const typeLabel = (ATTACK_MODE_TYPES.find(t => t.value === m.modeType) || {}).label || m.modeType;
        const handLabel = (HANDEDNESS_OPTIONS.find(h => h.value === m.handedness) || {}).label || m.handedness;
        const dmgSummary = m.damage.length ? m.damage.map(describeDamageEntry).join(', ') : '—';
        const spreadSummary = m.spread ? `; Rozrzut: ${describeDiceModifier(m.spread)}` : '';
        const effRangeSummary = (m.modeType === 'throw' || m.modeType === 'shot') && m.effectiveRange
            ? `; Efektywny Zasięg: ${m.effectiveRange}` : '';
        return `
            <div class="editor-req-row" style="flex-direction:column; align-items:flex-start; gap:0.2em;">
                <span><strong>${escapeHtml(m.name || '(bez nazwy)')}</strong> — ${escapeHtml(typeLabel)}, ${escapeHtml(handLabel)}, Celność ${m.baseAccuracy}, Zasięg ${m.minRange}–${m.maxRange}${escapeHtml(effRangeSummary)}</span>
                <span>Obrażenia: ${escapeHtml(dmgSummary)}${escapeHtml(spreadSummary)}</span>
                ${m.specialEffect ? `<span>Efekt: ${escapeHtml(m.specialEffect)}</span>` : ''}
                <button class="editor-btn editor-btn-small" data-remove-atkmode="${i}">✕ Usuń tryb</button>
            </div>
        `;
    }).join('');
}


// ============================================================
// Handlers
// ============================================================
export function wireItemEditorHandlers(rootEl, onSaved) {
    const statusEl = rootEl.querySelector('#item-editor-status');
    const setStatus = (msg, isError) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.classList.toggle('editor-status-error', !!isError);
    };

    const typeSelect = rootEl.querySelector('#ie-type');

    function updateTypeSectionVisibility() {
        const type = typeSelect.value;
        rootEl.querySelector('#item-editor-requirements-section').style.display =
            (type === 'weapon' || typeUsesArmourFields(type)) ? '' : 'none';
        rootEl.querySelector('#item-editor-type-weapon').style.display = (type === 'weapon') ? '' : 'none';
        rootEl.querySelector('#item-editor-type-armourfamily').style.display = typeUsesArmourFields(type) ? '' : 'none';
        rootEl.querySelector('#item-editor-type-utility').style.display = (type === 'utility') ? '' : 'none';

        rootEl.querySelector('#item-editor-armourlevel-wrap').style.display = (type === 'armour') ? '' : 'none';
        rootEl.querySelector('#item-editor-capacity-wrap').style.display = (type === 'storage') ? '' : 'none';

        const effectLabel = rootEl.querySelector('#ie-effectdesc-label');
        if (effectLabel) {
            const isSet = rootEl.querySelector('#ie-isset').checked;
            effectLabel.textContent = isSet ? 'Efekt Zestawu Pancerza' : 'Efekt Części Pancerza';
        }
    }
    typeSelect.addEventListener('change', updateTypeSectionVisibility);

    // ---- isSet toggle ----------------------------------------------
    const isSetCb = rootEl.querySelector('#ie-isset');
    isSetCb.addEventListener('change', () => {
        const wrap = rootEl.querySelector('#item-editor-setmembers-wrap');
        wrap.style.display = isSetCb.checked ? '' : 'none';
        updateTypeSectionVisibility();
    });

    // ---- Not-for-Sale toggle -----------------------------------------
    const notForSaleCb = rootEl.querySelector('#ie-notforsale');
    const priceInput   = rootEl.querySelector('#ie-price');
    notForSaleCb.addEventListener('change', () => {
        priceInput.disabled = notForSaleCb.checked;
    });

    // ---- Elementy zestawu (quantity-aware add/remove) -----------------
    function refreshSetMembersList() {
        const listEl = rootEl.querySelector('#item-editor-setmembers-list');
        if (!listEl) return;
        listEl.innerHTML = renderSetMembersList();
        listEl.querySelectorAll('[data-remove-setmember]').forEach(btn => {
            btn.addEventListener('click', () => {
                draft.setMembers.splice(Number(btn.dataset.removeSetmember), 1);
                refreshSetMembersList();
            });
        });
    }
    refreshSetMembersList();
    const setMemberAddBtn = rootEl.querySelector('#ie-setmember-add-btn');
    if (setMemberAddBtn) setMemberAddBtn.addEventListener('click', () => {
        const itemId = rootEl.querySelector('#ie-setmember-select').value;
        const qty = Number(rootEl.querySelector('#ie-setmember-qty').value);
        if (!itemId) { setStatus('Wybierz przedmiot do dodania do zestawu.', true); return; }
        if (!Number.isFinite(qty) || qty < 1 || !Number.isInteger(qty)) { setStatus('Ilość musi być dodatnią liczbą całkowitą.', true); return; }
        // Adding the same item again sums into its existing entry rather
        // than creating a duplicate row — this is how a set ends up able
        // to require e.g. two of the same arrow instead of only one.
        const existing = draft.setMembers.find(m => m.itemId === itemId);
        if (existing) existing.quantity += qty;
        else draft.setMembers.push({ itemId, quantity: qty });
        refreshSetMembersList();
        setStatus('');
    });

    // ---- attack-mode-in-progress: spread only for throw/shot -------
    const atkModeTypeSelect = rootEl.querySelector('#ie-atk-modetype');
    if (atkModeTypeSelect) {
        const spreadWrap = rootEl.querySelector('#item-editor-atk-spread-wrap');
        const updateSpreadVisibility = () => {
            spreadWrap.style.display = (atkModeTypeSelect.value === 'throw' || atkModeTypeSelect.value === 'shot') ? '' : 'none';
        };
        atkModeTypeSelect.addEventListener('change', updateSpreadVisibility);
        updateSpreadVisibility();
    }

    // ---- Wymagania (requirements) -----------------------------------
    function refreshRequirementsList() {
        const listEl = rootEl.querySelector('#item-editor-requirements-list');
        listEl.innerHTML = renderRequirementsList();
        listEl.querySelectorAll('[data-remove-req]').forEach(btn => {
            btn.addEventListener('click', () => {
                draft.requirements.splice(Number(btn.dataset.removeReq), 1);
                refreshRequirementsList();
            });
        });
    }
    refreshRequirementsList();
    rootEl.querySelector('#ie-req-add-btn').addEventListener('click', () => {
        const skill = rootEl.querySelector('#ie-req-skill').value;
        const min = Number(rootEl.querySelector('#ie-req-min').value);
        if (!Number.isFinite(min)) { setStatus('Podaj liczbową wartość minimalną wymogu.', true); return; }
        draft.requirements.push({ skill, min });
        refreshRequirementsList();
        setStatus('');
    });

    // ---- Ulepszenia ---------------------------------------------------
    function refreshUpgradesList() {
        const listEl = rootEl.querySelector('#item-editor-upgrades-list');
        if (!listEl) return;
        listEl.innerHTML = renderUpgradesList();
        listEl.querySelectorAll('[data-remove-upgrade]').forEach(btn => {
            btn.addEventListener('click', () => {
                draft.upgrades.splice(Number(btn.dataset.removeUpgrade), 1);
                refreshUpgradesList();
            });
        });
    }
    refreshUpgradesList();
    const upgradeAddBtn = rootEl.querySelector('#ie-upgrade-add-btn');
    if (upgradeAddBtn) upgradeAddBtn.addEventListener('click', () => {
        const input = rootEl.querySelector('#ie-upgrade-text');
        const text = input.value.trim();
        if (!text) return;
        draft.upgrades.push(text);
        input.value = '';
        refreshUpgradesList();
    });

    // ---- staged Obrażenia (for the attack-mode-in-progress mini-form) --
    function refreshDamageList() {
        const listEl = rootEl.querySelector('#item-editor-atkdamage-list');
        if (!listEl) return;
        listEl.innerHTML = renderPendingDamageList();
        listEl.querySelectorAll('[data-remove-dmg]').forEach(btn => {
            btn.addEventListener('click', () => {
                pendingDamage.splice(Number(btn.dataset.removeDmg), 1);
                refreshDamageList();
            });
        });
    }
    refreshDamageList();
    const dmgAddBtn = rootEl.querySelector('#ie-dmg-add-btn');
    if (dmgAddBtn) dmgAddBtn.addEventListener('click', () => {
        const count = Number(rootEl.querySelector('#ie-dmg-count').value) || 1;
        const dice = rootEl.querySelector('#ie-dmg-dice').value;
        const modifier = Number(rootEl.querySelector('#ie-dmg-mod').value) || 0;
        const type = rootEl.querySelector('#ie-dmg-type').value;
        pendingDamage.push({ count, dice, modifier, type });
        refreshDamageList();
    });

    // ---- Tryby Ataku ----------------------------------------------------
    function refreshAttackModesList() {
        const listEl = rootEl.querySelector('#item-editor-atkmodes-list');
        if (!listEl) return;
        listEl.innerHTML = renderAttackModesList();
        listEl.querySelectorAll('[data-remove-atkmode]').forEach(btn => {
            btn.addEventListener('click', () => {
                draft.attackModes.splice(Number(btn.dataset.removeAtkmode), 1);
                refreshAttackModesList();
            });
        });
    }
    refreshAttackModesList();
    const atkAddBtn = rootEl.querySelector('#ie-atk-add-btn');
    if (atkAddBtn) atkAddBtn.addEventListener('click', () => {
        const name = rootEl.querySelector('#ie-atk-name').value.trim();
        const modeType = rootEl.querySelector('#ie-atk-modetype').value;
        const handedness = rootEl.querySelector('#ie-atk-hand').value;
        const baseAccuracy = Number(rootEl.querySelector('#ie-atk-acc').value) || 0;
        const minRange = Number(rootEl.querySelector('#ie-atk-minrange').value) || 0;
        const maxRange = Number(rootEl.querySelector('#ie-atk-maxrange').value) || 0;
        const specialEffect = rootEl.querySelector('#ie-atk-special').value.trim();

        if (!name) { setStatus('Tryb ataku wymaga nazwy.', true); return; }

        let spread = null;
        let effectiveRange = null;
        if (modeType === 'throw' || modeType === 'shot') {
            spread = {
                count: Number(rootEl.querySelector('#ie-atk-spread-count').value) || 1,
                dice: rootEl.querySelector('#ie-atk-spread-dice').value,
                modifier: Number(rootEl.querySelector('#ie-atk-spread-mod').value) || 0,
            };
            effectiveRange = Number(rootEl.querySelector('#ie-atk-effrange').value);
            if (!Number.isFinite(effectiveRange) || effectiveRange < 1 || !Number.isInteger(effectiveRange)) {
                setStatus('Efektywny Zasięg musi być dodatnią liczbą całkowitą.', true);
                return;
            }
        }

        draft.attackModes.push({
            name, modeType, handedness, baseAccuracy,
            damage: pendingDamage.map(d => ({ ...d })),
            minRange, maxRange, spread, effectiveRange, specialEffect,
        });

        // Reset the mini-form for the next mode
        pendingDamage = [];
        rootEl.querySelector('#ie-atk-name').value = '';
        rootEl.querySelector('#ie-atk-acc').value = 0;
        rootEl.querySelector('#ie-atk-minrange').value = 0;
        rootEl.querySelector('#ie-atk-maxrange').value = 0;
        rootEl.querySelector('#ie-atk-effrange').value = 1;
        rootEl.querySelector('#ie-atk-special').value = '';

        refreshDamageList();
        refreshAttackModesList();
        setStatus('');
    });

    // ---- Create / Save Item ------------------------------------------
    rootEl.querySelector('#item-editor-create-btn').addEventListener('click', () => {
        const type = typeSelect.value;
        const name = rootEl.querySelector('#ie-name').value.trim();
        const notForSale = rootEl.querySelector('#ie-notforsale').checked;
        const bulk = Number(rootEl.querySelector('#ie-bulk').value);
        const state = rootEl.querySelector('#ie-state').value;
        const hitPoints = Number(rootEl.querySelector('#ie-hp').value);
        const toughness = Number(rootEl.querySelector('#ie-toughness').value);
        const desc = rootEl.querySelector('#ie-desc').value;

        if (!name) { setStatus('Nazwa nie może być pusta.', true); return; }

        let price = NOT_FOR_SALE;
        if (!notForSale) {
            price = Number(rootEl.querySelector('#ie-price').value);
            if (!Number.isFinite(price) || price < 0 || !Number.isInteger(price)) { setStatus('Cena musi być nieujemną liczbą całkowitą (w Nitkach Konstancjum), lub przedmiot musi być oznaczony jako Nie Sprzedawany.', true); return; }
        }
        if (!Number.isFinite(bulk) || bulk < 0) { setStatus('Obciążenie musi być nieujemną liczbą.', true); return; }
        if (!Number.isFinite(hitPoints) || hitPoints < 1 || !Number.isInteger(hitPoints)) { setStatus('Wytrzymałość musi być dodatnią liczbą całkowitą.', true); return; }
        if (!Number.isFinite(toughness) || !Number.isInteger(toughness)) { setStatus('Twardość musi być liczbą całkowitą.', true); return; }

        const item = { ...makeDefaultItem(type), name, price, bulk, state, hitPoints, toughness, desc };

        // The Set flag/members list applies to every item type. Each
        // entry is {itemId, quantity} — quantity may be > 1, so a set
        // can require several copies of the same component item.
        item.isSet = rootEl.querySelector('#ie-isset').checked;
        item.setMembers = item.isSet ? draft.setMembers.map(m => ({ ...m })) : [];

        if (type === 'weapon') {
            item.requirements = draft.requirements.map(r => ({ ...r }));
            item.block = Number(rootEl.querySelector('#ie-block').value) || 0;
            item.deflection = Number(rootEl.querySelector('#ie-deflection').value) || 0;
            item.weaponKinds = Array.from(rootEl.querySelectorAll('.ie-weaponkind-cb:checked')).map(cb => cb.value);
            item.proficiencyCategory = rootEl.querySelector('#ie-proficiency').value.trim();
            item.upgrades = [...draft.upgrades];
            item.attackModes = draft.attackModes.map(m => ({
                ...m,
                damage: m.damage.map(d => ({ ...d })),
                spread: m.spread ? { ...m.spread } : null,
            }));
        }

        if (typeUsesArmourFields(type)) {
            item.requirements = draft.requirements.map(r => ({ ...r }));
            item.equipSlots = Array.from(rootEl.querySelectorAll('.ie-slot-cb:checked')).map(cb => cb.value);
            item.equipLayers = Array.from(rootEl.querySelectorAll('.ie-layer-cb:checked')).map(cb => cb.value);
            item.effectDescription = rootEl.querySelector('#ie-effectdesc').value;
            item.equipTimeSeconds = Number(rootEl.querySelector('#ie-equip-sec').value) || 0;
            item.equipTimeActionPoints = Number(rootEl.querySelector('#ie-equip-ap').value) || 0;
            item.unequipTimeSeconds = Number(rootEl.querySelector('#ie-unequip-sec').value) || 0;
            item.unequipTimeActionPoints = Number(rootEl.querySelector('#ie-unequip-ap').value) || 0;
            if (type === 'armour') item.armourLevel = Number(rootEl.querySelector('#ie-armourlevel').value) || 1;
            if (type === 'storage') item.capacity = Number(rootEl.querySelector('#ie-capacity').value) || 0;
        }

        if (type === 'utility') {
            item.useCondition = rootEl.querySelector('#ie-usecond').value;
            item.useEffect = rootEl.querySelector('#ie-useeffect').value;
        }

        const editingId = editingItem ? editingItem.id : null;

        try {
            let stored;
            if (!editingId) {
                // Brand-new item — always a custom item.
                stored = addCustomItem(item);
            } else if (isBuiltInItemId(editingId)) {
                // Editing an EXISTING items.json item — stored as an
                // override rather than mutating items.json itself.
                // See equipmentState.js's "BUILT-IN ITEM OVERRIDES".
                stored = updateBuiltInItem(editingId, { ...item, id: editingId });
            } else {
                // Editing a player-created custom item — edited in place.
                stored = updateCustomItem(editingId, { ...item, id: editingId });
            }
            resetItemEditor();
            setStatus(`${editingId ? 'Zapisano' : 'Utworzono'} "${stored.name}".`);
            if (typeof onSaved === 'function') onSaved(stored);
        } catch (e) {
            setStatus(e.message || 'Nie udało się zapisać przedmiotu.', true);
        }
    });

    // ---- Delete Item ---------------------------------------------------
    // Only rendered when editing an existing item (see renderItemEditorHTML).
    // A CUSTOM item is removed outright (removeCustomItem — can't be undone).
    // A BUILT-IN item is soft-deleted instead (deleteBuiltInItem): it's
    // hidden from getAllItems()/getItemById()/ITEMS_CONFIG/exports without
    // items.json itself ever being touched, and can be brought back later
    // from Tryb Edycji's "Usunięte przedmioty" recovery list.
    const deleteBtn = rootEl.querySelector('#item-editor-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!editingItem) return;
            const id = editingItem.id;
            const name = editingItem.name;
            const builtIn = isBuiltInItemId(id);

            const confirmMsg = builtIn
                ? `Usunąć przedmiot wbudowany "${name}"? Zniknie z gry (ekwipunku, rynku, listy efektów perków) — plik items.json pozostanie nietknięty, a przedmiot można przywrócić później z listy "Usunięte przedmioty" w Tryb Edycji.`
                : `Usunąć własny przedmiot "${name}"? Tej operacji nie można cofnąć.`;
            if (!window.confirm(confirmMsg)) return;

            try {
                const ok = builtIn ? deleteBuiltInItem(id) : removeCustomItem(id);
                if (!ok) { setStatus('Nie udało się usunąć przedmiotu.', true); return; }

                resetItemEditor();
                setStatus(`Usunięto "${name}".`);
                if (typeof onSaved === 'function') onSaved(null);
            } catch (e) {
                setStatus(e.message || 'Nie udało się usunąć przedmiotu.', true);
            }
        });
    }

    // ---- Export ---------------------------------------------------------
    // Merges built-in (items.json, with any overrides applied) and custom
    // (Tryb Edycji) items into the exact { items: [...] } shape items.json
    // expects — the file this produces can replace items.json directly,
    // no manual merging/wrapping needed. getAllItems() already omits any
    // soft-deleted built-in items (see equipmentState.js), so a deleted
    // item never makes it back into an exported file.
    rootEl.querySelector('#item-editor-export-btn').addEventListener('click', () => {
        const data = { items: getAllItems() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'items.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus('Wyeksportowano items.json (wbudowane, z nadpisaniami, bez usuniętych + własne przedmioty) — podmień nim plik w projekcie.');
    });

    updateTypeSectionVisibility();
}

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
