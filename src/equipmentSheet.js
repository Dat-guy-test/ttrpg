// ============================================================
// EQUIPMENT SHEET  (Equipment tab)
//
// Builds the whole tab into #equipmentPage. Same render()/
// attachHandlers() pattern as characterSheet.js.
//
// Two internal "pages", tracked in module-level `view`:
//   'list'   — owned items + currency (default), or every item in
//              the game + its price when Rynek (market mode) is on
//   'detail' — full description of one item, reached by clicking a
//              row on either list. Shows a Buy button in market mode.
//
// Exports:
//   initEquipmentSheet()    — call once, after #equipmentPage exists.
//   refreshEquipmentSheet() — full re-render; called by perkEffects.js
//                             whenever a perk grants/revokes currency
//                             or an item.
// ============================================================

import {
    ITEMS,
    getItemById,
    getCurrency,
    setCurrency,
    getOwnedItems,
    getItemQuantity,
    setItemQuantity,
    buyItem,
    resetEquipmentState,
} from './equipmentState.js';

let rootEl = null;

const view = {
    page: 'list',        // 'list' | 'detail'
    marketMode: false,
    selectedItemId: null,
};

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
            ${view.page === 'detail' ? renderDetailPage() : renderListPage()}
        </div>
    `;
    attachHandlers();
}

function renderListPage() {
    const items = view.marketMode
        ? ITEMS.map(i => ({ ...i, quantity: getItemQuantity(i.id) }))
        : getOwnedItems();

    const rows = items.length === 0
        ? `<p class="charSection-hint">${view.marketMode ? 'Brak przedmiotów w bazie danych.' : 'Nie posiadasz jeszcze żadnych przedmiotów.'}</p>`
        : `<ul class="equipListRows">${items.map(i => `
            <li class="equipListRow" data-open-item="${escapeHtml(i.id)}">
                <span class="equipListRow-name">${escapeHtml(i.name)}</span>
                ${view.marketMode
                    ? `<span class="equipListRow-price">${i.price} pierścieni</span>`
                    : `<span class="equipListRow-qty">x${i.quantity}</span>`}
            </li>
        `).join('')}</ul>`;

    return `
        <section class="charSection">
            <h2 class="charSection-title">Ekwipunek</h2>
            <div class="equipMoneyRow">
                <label class="charField-label" for="equip-currency">Pierścienie</label>
                <input type="number" id="equip-currency" value="${getCurrency()}" />
            </div>
            <div class="equipSheet-toolbar">
                <button class="charBtn" id="equip-market-toggle">${view.marketMode ? 'Wróć do ekwipunku' : 'Otwórz rynek'}</button>
            </div>
            ${view.marketMode ? '<p class="charSection-hint">Rynek — wszystkie przedmioty dostępne w grze wraz z ceną. Kliknij, by zobaczyć szczegóły.</p>' : ''}
            ${rows}
        </section>
    `;
}

function renderDetailPage() {
    const item = getItemById(view.selectedItemId);
    if (!item) {
        return `
            <section class="charSection">
                <p class="charSection-hint">Nie znaleziono przedmiotu.</p>
                <button class="charBtn" id="equip-back-btn">Wróć do listy</button>
            </section>`;
    }
    const owned  = getItemQuantity(item.id);
    const canBuy = view.marketMode && getCurrency() >= item.price;

    return `
        <section class="charSection">
            <button class="charBtn" id="equip-back-btn">&larr; Wróć do listy</button>
            <h2 class="charSection-title">${escapeHtml(item.name)}</h2>
            <p class="equipDetail-category">${escapeHtml(item.category || '')}</p>
            <p class="equipDetail-desc">${escapeHtml(item.desc)}</p>
            <div class="charRow">
                <div class="statWrapper charResourceBox">
                    <div class="statLabel">Cena</div>
                    <div class="statValue">${item.price} pierścieni</div>
                </div>
                <div class="statWrapper charResourceBox">
                    <div class="statLabel">Posiadane</div>
                    <div class="statValue">
                        <button class="charSpend-btn" id="equip-qty-minus" ${owned <= 0 ? 'disabled' : ''}>–</button>
                        <span>${owned}</span>
                        <button class="charSpend-btn" id="equip-qty-plus">+</button>
                    </div>
                </div>
            </div>
            ${view.marketMode ? `<button class="charBtn" id="equip-buy-btn" ${canBuy ? '' : 'disabled'}>Kup za ${item.price} pierścieni</button>` : ''}
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
        rootEl.querySelector('#equip-currency').addEventListener('input', (e) => {
            setCurrency(e.target.value);
        });
        rootEl.querySelector('#equip-market-toggle').addEventListener('click', () => {
            view.marketMode = !view.marketMode;
            render();
        });
        rootEl.querySelectorAll('[data-open-item]').forEach(row => {
            row.addEventListener('click', () => {
                view.selectedItemId = row.dataset.openItem;
                view.page = 'detail';
                render();
            });
        });
    } else {
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
            rootEl.querySelector('#equip-qty-plus').addEventListener('click', () => {
                setItemQuantity(item.id, getItemQuantity(item.id) + 1);
                render();
            });
            const buyBtn = rootEl.querySelector('#equip-buy-btn');
            if (buyBtn) buyBtn.addEventListener('click', () => {
                if (buyItem(item.id)) render();
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
