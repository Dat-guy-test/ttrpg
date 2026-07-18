// ============================================================
// EQUIPMENT SHEET  (Equipment tab)
//
// Builds the whole tab into #equipmentPage. Same render()/
// attachHandlers() pattern as characterSheet.js.
//
// Three internal "pages", tracked in module-level `view`:
//   'list'   — owned items + currency (default), or every item in
//              the game + its price when Rynek (market mode) is on
//   'detail' — full description of one item, reached by clicking a
//              row on either list. Shows a Buy button in market mode.
//   'edit'   — "Tryb Edycji": the item form from itemEditor.js, for
//              creating a brand-new custom item, editing an existing
//              CUSTOM item, or editing an EXISTING items.json
//              (built-in) item. Reachable via a selector on this
//              page (grouped "Wbudowane (items.json)" / "Własne"),
//              or via the "Edytuj przedmiot" button on any item's
//              detail page. Editing a built-in item stores an
//              "override" rather than mutating items.json — see
//              equipmentState.js's "BUILT-IN ITEM OVERRIDES" section.
//
// Exports:
//   initEquipmentSheet()    — call once, after #equipmentPage exists.
//   refreshEquipmentSheet() — full re-render; called by perkEffects.js
//                             whenever a perk's modifier grants/revokes
//                             currency or an item.
// ============================================================


import { getSellMode } from './progressionState.js';

import {
    getAllItems, getCustomItems, getItemById, getCurrency, formatCurrencyParts,
    formatItemPrice, isNotForSale, getOwnedItems, getItemQuantity, setItemQuantity,
        buyItem, sellItem, canAssembleSet, assembleSet, splitSet, resetEquipmentState,
        isBuiltInItemId, hasBuiltInOverride, resetBuiltInItemOverride,
        getDeletedBuiltInItems, restoreBuiltInItem,
} from './equipmentState.js';
import {
    ITEM_TYPES, ITEM_STATES, WEAPON_KINDS, ATTACK_MODE_TYPES,
    HANDEDNESS_OPTIONS, DAMAGE_TYPES, EQUIP_SLOTS, EQUIP_LAYERS,
    EQUIP_REQUIREMENT_SKILLS, ACCESSORY_SIZES, formatDiceExpression,
} from './itemSchema.js';
import { resetItemEditor, renderItemEditorHTML, wireItemEditorHandlers } from './itemEditor.js';

let rootEl = null;

const view = {
    page: 'list',        // 'list' | 'detail' | 'edit'
    marketMode: false,
    selectedItemId: null,
    editingItemId: null, // item id (built-in or custom) being edited on the 'edit' page, or null when creating a new one
};

/** True if `id` belongs to a player-created custom item (as opposed to a built-in items.json item). */
function isCustomItemId(id) {
    return getCustomItems().some(i => i.id === id);
}

export function initEquipmentSheet() {
    rootEl = document.getElementById('equipmentPage');
    if (!rootEl) {
        console.error('equipmentSheet: no #equipmentPage element found in the DOM.');
        return;
    }
    render();
}

export function refreshEquipmentSheet() {
    if (rootEl) render();
}

function render() {
    rootEl.innerHTML = `
        <div class="equipSheet">
            <div class="equipSheet-toolbar">
                <button class="charBtn" id="equip-print-btn"><span>Drukuj</span></button>
                <button class="charBtn charBtn-danger" id="equip-reset-btn"><span>Resetuj ekwipunek</span></button>
            </div>
            ${view.page === 'detail' ? renderDetailPage() : (view.page === 'edit' ? renderEditPage() : renderListPage())}
        </div>
    `;
    attachHandlers();
}

function renderListPage() {
    const items = view.marketMode
        ? getAllItems().map(i => ({ ...i, quantity: getItemQuantity(i.id) }))
        : getOwnedItems();

    const rows = items.length === 0
        ? `<p class="charSection-hint">${view.marketMode ? 'Brak przedmiotów w bazie danych.' : 'Nie posiadasz jeszcze żadnych przedmiotów.'}</p>`
        : `<ul class="equipListRows">${items.map(i => `
            <li class="equipListRow" data-open-item="${escapeHtml(i.id)}">
                <span class="equipListRow-name">${escapeHtml(i.name)}</span>
                ${view.marketMode
                    ? `<span class="equipListRow-price">${escapeHtml(formatItemPrice(i.price))}</span>`
                    : `<span class="equipListRow-qty">x${i.quantity}</span>`}
            </li>
        `).join('')}</ul>`;

    const { pieces, rings, strands } = formatCurrencyParts(getCurrency());

    return `
        <section class="charSection">
            <h2 class="charSection-title">Ekwipunek</h2>
            <div class="equipMoneyRow">
                <div class="equipMoneyDenom">
                    <span class="charField-label">Sztuki Konstancjum</span>
                    <span class="charStat-readonly" id="equip-currency-pieces">${pieces}</span>
                </div>
                <div class="equipMoneyDenom">
                    <span class="charField-label">Pierścienie Konstancjum</span>
                    <span class="charStat-readonly" id="equip-currency-rings">${rings}</span>
                </div>
                <div class="equipMoneyDenom">
                    <span class="charField-label">Nitki Konstancjum</span>
                    <span class="charStat-readonly" id="equip-currency-strands">${strands}</span>
                </div>
            </div>
            <div class="equipSheet-toolbar">
                <button class="charBtn" id="equip-market-toggle">${view.marketMode ? 'Wróć do ekwipunku' : 'Otwórz rynek'}</button>
                <button class="charBtn" id="equip-edit-toggle">Tryb Edycji</button>
            </div>
            ${view.marketMode ? '<p class="charSection-hint">Rynek — wszystkie przedmioty dostępne w grze wraz z ceną. Kliknij, by zobaczyć szczegóły.</p>' : ''}
            ${rows}
        </section>
    `;
}

function renderEditPage() {
    const customItems = getCustomItems();
    // getAllItems() returns built-ins (with any override applied) followed
    // by custom items — filtering out custom ids leaves just the built-ins,
    // already showing each one's current (possibly overridden) name.
    const builtInItems = getAllItems().filter(i => !isCustomItemId(i.id));

    return `
        <div class="equipSheet-toolbar">
            <button class="charBtn" id="equip-edit-back-btn">&larr; Wróć do listy</button>
        </div>
        <div class="editor-row" style="margin-bottom:1em;">
            <div style="flex:1;">
                <label class="charField-label" for="equip-edit-item-select">Edytowany przedmiot</label>
                <select id="equip-edit-item-select">
                    <option value="">— Nowy przedmiot —</option>
                    <optgroup label="Wbudowane (items.json)">
                        ${builtInItems.map(i => `
                            <option value="${escapeHtml(i.id)}" ${view.editingItemId === i.id ? 'selected' : ''}>
                                ${escapeHtml(i.name)}${hasBuiltInOverride(i.id) ? ' (zmodyfikowany)' : ''}
                            </option>
                        `).join('')}
                    </optgroup>
                    <optgroup label="Własne">
                        ${customItems.map(i => `<option value="${escapeHtml(i.id)}" ${view.editingItemId === i.id ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
                    </optgroup>
                </select>
            </div>
        </div>
        <p class="charSection-hint">Wybranie przedmiotu wbudowanego pozwala go edytować — zapis tworzy lokalne nadpisanie zamiast zmieniać plik items.json (zobacz uwagę poniżej formularza).</p>
        ${renderDeletedItemsSection()}
        ${renderItemEditorHTML()}
    `;
}

/**
 * Small recovery list for built-in items that have been soft-deleted
 * (see equipmentState.js's "BUILT-IN ITEM DELETIONS"). A deleted
 * built-in vanishes from getAllItems() — and therefore from the
 * "Wbudowane" dropdown above — so this is the only place left to find
 * and undo that deletion. Empty (renders nothing) when no built-in
 * item is currently deleted.
 */
function renderDeletedItemsSection() {
    const deleted = getDeletedBuiltInItems();
    if (deleted.length === 0) return '';

    return `
        <section class="charSection" style="margin-top:0.5em;">
            <h3 class="charSection-title">Usunięte przedmioty (wbudowane)</h3>
            <p class="charSection-hint">Te przedmioty wbudowane zostały ukryte w grze, ale plik items.json wciąż je zawiera. Przywróć, by znów były dostępne.</p>
            <ul class="equipListRows">
                ${deleted.map(i => `
                    <li class="equipListRow" style="cursor:default;">
                        <span class="equipListRow-name">${escapeHtml(i.name)}</span>
                        <button class="charBtn charBtn-small" data-restore-builtin="${escapeHtml(i.id)}">Przywróć</button>
                    </li>
                `).join('')}
            </ul>
        </section>
    `;
}

/** Human-readable label lookups for the extended item schema, used by renderItemExtraDetails(). */
function labelOf(list, value) {
    const entry = list.find(o => o.value === value || o.key === value);
    return entry ? entry.label : value;
}
// small helper, next to the other render* helpers:
function renderSellSection(item, owned, sellMode, halfPrice) {
    if (owned <= 0) return '';
    if (sellMode === null) {
        return `<p class="charSection-hint">Sprzedaż przedmiotów jest niedostępna podczas etapu Rozwoju Postaci.</p>`;
    }
    if (sellMode === 'full') {
        if (isNotForSale(item.price)) return '';
        return `
        <div class="equipSheet-toolbar" style="justify-content:flex-start;">
        <button class="charBtn" id="equip-sell-full-btn">Sprzedaj za ${escapeHtml(formatItemPrice(item.price))}</button>
        </div>
        `;
    }
    return `
    <div class="equipSheet-toolbar" style="justify-content:flex-start;">
    <button class="charBtn" id="equip-sell-half-btn">Sprzedaj za połowę (${halfPrice})</button>
    <input id="equip-sell-custom-price" type="number" min="0" step="1" placeholder="Cena zaakceptowana przez MG" style="max-width:10em;" />
    <button class="charBtn" id="equip-sell-custom-btn">Sprzedaj za cenę MG</button>
    </div>
    `;
}

function renderRequirementsBlock(requirements) {
    if (!requirements || requirements.length === 0) return '';
    const rows = requirements.map(r => `<li>${escapeHtml(labelOf(EQUIP_REQUIREMENT_SKILLS.map(s => ({ value: s.key, label: s.label })), r.skill))} ≥ ${r.min}</li>`).join('');
    return `<p class="equipDetail-category">Wymagania</p><ul>${rows}</ul>`;
}

function renderAttackModesBlock(attackModes) {
    if (!attackModes || attackModes.length === 0) return '';
    const rows = attackModes.map(m => {
        const dmg = (m.damage || []).map(d => `${formatDiceExpression(d)} (${escapeHtml(labelOf(DAMAGE_TYPES, d.type))})`).join(', ') || '—';
        const spread = m.spread ? `; Rozrzut: ${formatDiceExpression(m.spread)}` : '';
        const effRange = (m.modeType === 'throw' || m.modeType === 'shot') && m.effectiveRange ? `; Efektywny Zasięg: ${m.effectiveRange}` : '';
        return `
            <li>
                <strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(labelOf(ATTACK_MODE_TYPES, m.modeType))}, ${escapeHtml(labelOf(HANDEDNESS_OPTIONS, m.handedness))},
                Celność ${m.baseAccuracy}, Zasięg ${m.minRange}–${m.maxRange}${escapeHtml(effRange)}<br/>
                Obrażenia: ${dmg}${spread}
                ${m.specialEffect ? `<br/>Efekt: ${escapeHtml(m.specialEffect)}` : ''}
            </li>
        `;
    }).join('');
    return `<p class="equipDetail-category">Tryby Ataku</p><ul>${rows}</ul>`;
}

/** Zestaw (Set) applies to every item type, so it's shown once, ahead of the type-specific extras. */
function renderSetBlock(item) {
    if (!item.isSet) return '';
    const memberLabels = (item.setMembers || []).map(m => {
        // Accepts both the current {itemId, quantity} shape and the
        // older plain-id-string shape (implicitly quantity 1).
        const memberId = typeof m === 'string' ? m : m.itemId;
        const qty      = typeof m === 'string' ? 1 : (Number(m.quantity) || 1);
        const member   = getItemById(memberId);
        return `${qty}x ${escapeHtml(member ? member.name : memberId)}`;
    });
    return `<p class="equipDetail-category">Zestaw${memberLabels.length ? `: ${memberLabels.join(', ')}` : ''}</p>`;
}

/** Extra, type-dependent fields shown on the detail page below the base price/quantity box. */
function renderItemExtraDetails(item) {
    if (item.type === 'weapon') {
        return `
            <div class="equipDetail-extra">
                <p>Blokowanie: ${item.block ?? 0} · Odbicie: ${item.deflection ?? 0}</p>
                ${item.weaponKinds && item.weaponKinds.length ? `<p>Typ broni: ${item.weaponKinds.map(k => escapeHtml(labelOf(WEAPON_KINDS, k))).join(', ')}</p>` : ''}
                ${item.proficiencyCategory ? `<p>Kategoria Wprawy: ${escapeHtml(item.proficiencyCategory)}</p>` : ''}
                ${item.upgrades && item.upgrades.length ? `<p>Ulepszenia: ${item.upgrades.map(escapeHtml).join(', ')}</p>` : ''}
                ${renderRequirementsBlock(item.requirements)}
                ${renderAttackModesBlock(item.attackModes)}
            </div>
        `;
    }

    if (item.type === 'armour' || item.type === 'clothing' || item.type === 'storage') {
        return `
            <div class="equipDetail-extra">
                ${item.armourLevel !== undefined ? `<p>Poziom Pancerza: ${item.armourLevel}</p>` : ''}
                ${item.capacity !== undefined ? `<p>Pojemność: ${item.capacity}</p>` : ''}
                ${item.accessorySlots ? `<p>Sloty na Akcesoria: Małe ${item.accessorySlots.small ?? 0} · Średnie ${item.accessorySlots.medium ?? 0} · Duże ${item.accessorySlots.large ?? 0}</p>` : ''}
                ${item.equipSlots && item.equipSlots.length ? `<p>Miejsce Wyposażenia: ${item.equipSlots.map(s => escapeHtml(labelOf(EQUIP_SLOTS, s))).join(', ')}</p>` : ''}
                ${item.equipLayers && item.equipLayers.length ? `<p>Warstwa: ${item.equipLayers.map(l => escapeHtml(labelOf(EQUIP_LAYERS, l))).join(', ')}</p>` : ''}
                ${item.effectDescription ? `<p>${item.isSet ? 'Efekt Zestawu Pancerza' : 'Efekt Części Pancerza'}: ${escapeHtml(item.effectDescription)}</p>` : ''}
                <p>Czas Wyposażania: ${item.equipTimeSeconds ?? 0} s / ${item.equipTimeActionPoints ?? 0} PA · Czas Zdejmowania: ${item.unequipTimeSeconds ?? 0} s / ${item.unequipTimeActionPoints ?? 0} PA</p>
                ${renderRequirementsBlock(item.requirements)}
            </div>
        `;
    }

    if (item.type === 'utility') {
        return `
            <div class="equipDetail-extra">
                ${item.useCondition ? `<p>Warunek Użycia: ${escapeHtml(item.useCondition)}</p>` : ''}
                ${item.useEffect ? `<p>Efekt Użycia: ${escapeHtml(item.useEffect)}</p>` : ''}
            </div>
        `;
    }

    return '';
}

function renderDetailPage() {
    const item = getItemById(view.selectedItemId);
    const sellMode = getSellMode();
    const halfPrice = isNotForSale(item.price) ? 0 : Math.ceil((Number(item.price) || 0) / 2);
    if (!item) {
        return `
            <section class="charSection">
                <p class="charSection-hint">Nie znaleziono przedmiotu.</p>
                <button class="charBtn" id="equip-back-btn">Wróć do listy</button>
            </section>`;
    }
    const owned  = getItemQuantity(item.id);
    const notForSale = isNotForSale(item.price);
    const canBuy = view.marketMode && !notForSale && getCurrency() >= item.price;
    const typeLabel = labelOf(ITEM_TYPES.map(t => ({ value: t.value, label: t.label })), item.type) || item.category || '';
    const stateLabel = item.state ? labelOf(ITEM_STATES.map(s => ({ value: s.value, label: s.label })), item.state) : null;

    // Any known item (built-in or custom) can be edited now; the fallback
    // shape getOwnedItems() builds for a deleted/unknown item belongs to
    // neither list, so it correctly gets no edit button at all.
    const isEditable = isBuiltInItemId(item.id) || isCustomItemId(item.id);
    const isOverriddenBuiltIn = isBuiltInItemId(item.id) && hasBuiltInOverride(item.id);

    return `
        <section class="charSection">
            <button class="charBtn" id="equip-back-btn">&larr; Wróć do listy</button>
            <h2 class="charSection-title">${escapeHtml(item.name)}${isOverriddenBuiltIn ? ' (zmodyfikowany)' : ''}</h2>
            <p class="equipDetail-category">${escapeHtml(typeLabel)}</p>
            ${item.accessorySize ? `<p class="equipDetail-category">Rozmiar Akcesorium: ${escapeHtml(labelOf(ACCESSORY_SIZES, item.accessorySize))}</p>` : ''}
            <p class="equipDetail-desc">${escapeHtml(item.desc)}</p>
            <div class="charRow">
                <div class="statWrapper charResourceBox">
                    <div class="statLabel">Cena</div>
                    <div class="statValue">${escapeHtml(formatItemPrice(item.price))}</div>
                </div>
                <div class="statWrapper charResourceBox">
                    <div class="statLabel">Posiadane</div>
                    <div class="statValue">
                        <span>${owned}</span>
                    </div>
                </div>
            </div>
            ${item.bulk !== undefined || item.hitPoints !== undefined ? `<p class="equipDetail-category">Obciążenie: ${item.bulk ?? 0} · Wytrzymałość: ${item.hitPoints ?? '—'} · Twardość: ${item.toughness ?? 0}${stateLabel ? ` · Stan: ${escapeHtml(stateLabel)}` : ''}</p>` : ''}
            ${renderSetBlock(item)}
            ${renderItemExtraDetails(item)}
            <div class="equipSheet-toolbar" style="justify-content:flex-start;">
            ${view.marketMode
                ? (notForSale
                ? `<p class="charSection-hint">Ten przedmiot nie jest sprzedawany.</p>`
                : `<button class="charBtn" id="equip-buy-btn" ${canBuy ? '' : 'disabled'}>Kup za ${escapeHtml(formatItemPrice(item.price))}</button>`)
                : ''}
                ${item.isSet ? `<button class="charBtn" id="equip-split-btn" ${owned > 0 ? '' : 'disabled'} title="Rozłóż jeden zestaw na jego elementy">Rozłóż zestaw</button>` : ''}
                ${item.isSet ? `<button class="charBtn" id="equip-assemble-btn" ${canAssembleSet(item.id) ? '' : 'disabled'} title="Złóż zestaw z posiadanych elementów">Złóż zestaw</button>` : ''}
                ${isEditable ? `<button class="charBtn" id="equip-edit-item-btn">Edytuj przedmiot</button>` : ''}
                ${isOverriddenBuiltIn ? `<button class="charBtn charBtn-danger" id="equip-reset-override-btn" title="Odrzuć zmiany i przywróć wersję z items.json">Przywróć oryginał</button>` : ''}
                </div>
                ${renderSellSection(item, owned, sellMode, halfPrice)}
        </section>
    `;
}

function attachHandlers() {
    rootEl.querySelector('#equip-print-btn').addEventListener('click', () => window.print());
    rootEl.querySelector('#equip-reset-btn').addEventListener('click', () => {
        if (window.confirm('Zresetować cały ekwipunek? Tej operacji nie można cofnąć.')) {
            resetEquipmentState();
            render();
        }
    });

    if (view.page === 'list') {
        rootEl.querySelector('#equip-market-toggle').addEventListener('click', () => {
            view.marketMode = !view.marketMode;
            render();
        });
        rootEl.querySelector('#equip-edit-toggle').addEventListener('click', () => {
            view.editingItemId = null;
            resetItemEditor();
            view.page = 'edit';
            render();
        });
        rootEl.querySelectorAll('[data-open-item]').forEach(row => {
            row.addEventListener('click', () => {
                view.selectedItemId = row.dataset.openItem;
                view.page = 'detail';
                render();
            });
        });
    } else if (view.page === 'edit') {
        rootEl.querySelector('#equip-edit-back-btn').addEventListener('click', () => {
            view.editingItemId = null;
            view.page = 'list';
            render();
        });
        rootEl.querySelector('#equip-edit-item-select').addEventListener('change', (e) => {
            const id = e.target.value || null;
            view.editingItemId = id;
            resetItemEditor(id ? getItemById(id) : null);
            render();
        });
        rootEl.querySelectorAll('[data-restore-builtin]').forEach(btn => {
            btn.addEventListener('click', () => {
                restoreBuiltInItem(btn.dataset.restoreBuiltin);
                render();
            });
        });
        wireItemEditorHandlers(rootEl, () => {
            view.editingItemId = null;
            view.page = 'list';
            render();
        });
    } else {
        const sellFullBtn = rootEl.querySelector('#equip-sell-full-btn');
        if (sellFullBtn) sellFullBtn.addEventListener('click', () => {
            if (sellItem(item.id)) render();
        });
            const sellHalfBtn = rootEl.querySelector('#equip-sell-half-btn');
            if (sellHalfBtn) sellHalfBtn.addEventListener('click', () => {
                const half = isNotForSale(item.price) ? 0 : Math.ceil((Number(item.price) || 0) / 2);
                if (sellItem(item.id, half)) render();
            });
                const sellCustomBtn = rootEl.querySelector('#equip-sell-custom-btn');
                if (sellCustomBtn) sellCustomBtn.addEventListener('click', () => {
                    const input = rootEl.querySelector('#equip-sell-custom-price');
                    const val = Number(input.value);
                    if (!Number.isFinite(val) || val < 0) { window.alert('Podaj poprawną, nieujemną cenę zaakceptowaną przez MG.'); return; }
                    if (sellItem(item.id, val)) render();
                });
        rootEl.querySelector('#equip-back-btn').addEventListener('click', () => {
            view.page = 'list';
            render();
        });
        const item = getItemById(view.selectedItemId);
        if (item) {
            const minusBtn = rootEl.querySelector('#equip-qty-minus');
            if (minusBtn) minusBtn.addEventListener('click', () => {
                setItemQuantity(item.id, getItemQuantity(item.id) - 1);
                render();
            });
            const plusBtn = rootEl.querySelector('#equip-qty-plus');
            if (plusBtn) plusBtn.addEventListener('click', () => {
                setItemQuantity(item.id, getItemQuantity(item.id) + 1);
                render();
            });
            const buyBtn = rootEl.querySelector('#equip-buy-btn');
            if (buyBtn) buyBtn.addEventListener('click', () => {
                if (buyItem(item.id)) render();
            });
                const splitBtn = rootEl.querySelector('#equip-split-btn');
                if (splitBtn) splitBtn.addEventListener('click', () => {
                    if (splitSet(item.id)) render();
                });
                    const assembleBtn = rootEl.querySelector('#equip-assemble-btn');
                    if (assembleBtn) assembleBtn.addEventListener('click', () => {
                        if (assembleSet(item.id)) render();
                    });
                        const editBtn = rootEl.querySelector('#equip-edit-item-btn');
                        if (editBtn) editBtn.addEventListener('click', () => {
                            view.editingItemId = item.id;
                            resetItemEditor(item);
                            view.page = 'edit';
                            render();
                        });
                        const resetOverrideBtn = rootEl.querySelector('#equip-reset-override-btn');
                        if (resetOverrideBtn) resetOverrideBtn.addEventListener('click', () => {
                            if (window.confirm(`Przywrócić oryginalną wersję "${item.name}" z items.json? Twoje zmiany do tego przedmiotu zostaną utracone.`)) {
                                resetBuiltInItemOverride(item.id);
                                render();
                            }
                        });
        }
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
