// ============================================================
// CHARACTER SHEET  (Character Data tab)
//
// Builds the whole sheet into an existing #characterPage element
// and wires up every editable input. Same approach as editMode.js:
// one initCharacterSheet() call builds static structure, event
// delegation handles the rest.
//
// Editable by the player: Nazwa, Potencjał (max perk points),
// resource "current" values, damage table.
// Everything else (Dostępny Potencjał, Charakterystyki, Umiejętności,
// resource maxima, Wprawa, Atrybuty) is perk-only or derived —
// displayed read-only here. See characterState.js for how each is
// computed.
//
// Exports:
//   initCharacterSheet()    — call once, after #characterPage exists.
//   refreshCharacterSheet() — full re-render; called by perkEffects.js
//                             whenever a perk's contribution changes,
//                             and safe to call any other time
//                             CharacterState changes in bulk.
// ============================================================

import {
    CharacterState,
    saveCharacterState,
    resetCharacterState,
    computeStatValue,
    computeDamageTotal,
    computeResourceMax,
    computePotentialAvailable,
    setPotentialTotal,
    MIN_POTENTIAL,
    formatImprovisation,
        CHARACTERISTICS_CONFIG,
        ABILITIES_CONFIG,
        DAMAGE_ROWS_CONFIG,
        POINT_POOLS_CONFIG,
        computePoolSpent,
        computePoolAvailable,
        getFieldPoolAllocation,
        adjustPoolAllocation,
} from './characterState.js';

const CHARACTERISTIC_POOL = POINT_POOLS_CONFIG.find(p => p.key === 'characteristicPoints');

let rootEl = null;

// ============================================================
// initCharacterSheet
// ============================================================
export function initCharacterSheet() {
    rootEl = document.getElementById('characterPage');
    if (!rootEl) {
        console.error('characterSheet: no #characterPage element found in the DOM.');
        return;
    }
    render();
}

/** Full re-render — safe to call any time CharacterState changes in bulk. */
export function refreshCharacterSheet() {
    if (rootEl) render();
}


// ============================================================
// Top-level render
// ============================================================
function render() {
    rootEl.innerHTML = `
    <div class="charSheet">
    <div class="charSheet-toolbar">
    <button class="charBtn" id="char-print-btn"><span>Drukuj</span></button>
    <button class="charBtn charBtn-danger" id="char-reset-btn"><span>Resetuj arkusz</span></button>
    </div>

    ${renderHeader()}
    <div class="charRow">
    ${renderResources()}
    ${renderDamageTable()}
    </div>
    <div class="charRow">
    ${renderCharacteristicsSection()}
    ${renderAbilitiesSection()}
    </div>
    ${renderProficienciesSection()}
    ${renderAttributesSection()}
    ${renderPerksSection()}
    ${renderPointPoolsSection()}
    </div>
    `;

    attachHandlers();
}


// ============================================================
// Section templates
// ============================================================

function renderHeader() {
    const { name, potential } = CharacterState;
    const available = computePotentialAvailable();
    return `
    <section class="charHeader" id="characterNameWrapper">
    <div class="charField charField-name">
    <label class="charField-label">Nazwa Postaci</label>
    <input type="text" id="char-name" value="${escapeHtml(name)}" placeholder="Imię postaci" />
    </div>
    <div class="charField">
    <label class="charField-label">Potencjał</label>
    <input type="number" id="char-potential-total" min="${MIN_POTENTIAL}" value="${potential.total}" />
    </div>
    <div class="charField">
    <label class="charField-label">Dostępny Potencjał</label>
    <span class="charStat-readonly" id="char-potential-available">${available}</span>
    </div>
    </section>
    `;
}

function renderResources() {
    const { actionPoints, energyPoints } = CharacterState.resources;

    const apRow = renderResourceRow(
        'Punkty Akcji',
        `<input type="number" class="charResource-input" data-resource="actionPoints" value="${actionPoints.current}" />`,
        computeResourceMax('actionPoints')
    );
    const epRow = renderResourceRow(
        'Punkty Energii',
        `<input type="number" class="charResource-input" data-resource="energyPoints" value="${energyPoints.current}" />`,
        computeResourceMax('energyPoints')
    );
    // Wytrzymałość has no player-editable "current" — its current-column
    // cell shows the Punkty Obrażeń total instead (see task instructions);
    // its max is still read off the linked Charakterystyka (Forma), same
    // as every other resource.
    const enRow = renderResourceRow(
        'Wytrzymałość',
        `<span class="charStat-readonly">${computeDamageTotal()}</span>`,
                                    computeResourceMax('endurance')
    );

    return `
    <section class="charSection charSection-half">
    <h2 class="charSection-title">Zasoby</h2>
    <table class="charTable charTable-resources">
    <thead><tr><th>Zasób</th><th>Obecnie</th><th>Maks.</th></tr></thead>
    <tbody>${apRow}${epRow}${enRow}</tbody>
    </table>
    <p class="charSection-hint">Maksimum to wartość powiązanej Charakterystyki (Bystrość / Siła Woli / Forma). Wytrzymałość: "Obecnie" pokazuje łączną liczbę Punktów Obrażeń.</p>
    </section>
    `;
}

/** One row of the Zasoby table. `currentCellHtml` is either a player input or a readonly span (Wytrzymałość). */
function renderResourceRow(label, currentCellHtml, max) {
    const maxTitle = max.isModified ? escapeHtml(modifierBreakdown(max.modifiers)) : '';
    return `
    <tr>
    <td class="charTable-rowLabel">${escapeHtml(label)}</td>
    <td>${currentCellHtml}</td>
    <td><span class="charStat-readonly" ${maxTitle ? `title="${maxTitle}"` : ''}>${max.value}</span></td>
    </tr>
    `;
}

function renderDamageTable() {
    const rows = DAMAGE_ROWS_CONFIG.map(row => {
        const val = CharacterState.damage[row.key];
        return `
        <tr class="${row.critical ? 'dmgTable-critical' : ''}">
        <td class="dmgTable-rowLabel">${escapeHtml(row.label)}</td>
        <td><input type="number" min="0" class="dmgTable-input" data-dmg-row="${row.key}" data-dmg-col="nZal" value="${val.nZal}" /></td>
        <td><input type="number" min="0" class="dmgTable-input" data-dmg-row="${row.key}" data-dmg-col="zal" value="${val.zal}" /></td>
        </tr>
        `;
    }).join('');

    return `
    <section class="charSection charSection-half">
    <h2 class="charSection-title">Punkty Obrażeń</h2>
    <table class="dmgTable">
    <thead>
    <tr><th></th><th>N. Zal.</th><th>Zal.</th></tr>
    </thead>
    <tbody>
    ${rows}
    <tr class="dmgTable-totalRow">
    <td class="dmgTable-rowLabel">Łącznie:</td>
    <td colspan="2"><output id="char-dmg-total">${computeDamageTotal()}</output></td>
    </tr>
    </tbody>
    </table>
    </section>
    `;
}

/** Summary boxes: how many points each pool has granted vs. how many are still unspent. */
function renderPointPoolsSection() {
    const boxes = POINT_POOLS_CONFIG.map(cfg => {
        const granted   = computeStatValue(CharacterState.pointPools[cfg.key].granted).value;
        const available = computePoolAvailable(cfg.key);
        return `
        <div class="statWrapper charResourceBox">
        <div class="statLabel">${escapeHtml(cfg.label)}</div>
        <div class="statValue charResourceBox-value">
        <span class="charStat-readonly">${available}</span>
        <span class="charResourceBox-slash">/</span>
        <span class="charStat-readonly charResourceBox-max">${granted}</span>
        </div>
        </div>
        `;
    }).join('');

    return `
    <section class="charSection">
    <h2 class="charSection-title">Punkty do Rozdania</h2>
    <div class="charResourceGroup">${boxes}</div>
    <p class="charSection-hint">Przyznawane przez perki. Rozdzielaj je przyciskami +/- przy Charakterystykach i Umiejętnościach poniżej.</p>
    </section>
    `;
}

/** A +/- pair for spending one point from `poolKey` into `fieldPath`. Buttons disable themselves when spending/refunding isn't possible. */
function renderPointSpender(poolKey, fieldPath) {
    const allocatedHere = getFieldPoolAllocation(fieldPath, poolKey);
    const available     = computePoolAvailable(poolKey);
    return `
    <button class="charSpend-btn" data-spend-pool="${poolKey}" data-spend-path="${fieldPath}" data-spend-delta="-1" ${allocatedHere <= 0 ? 'disabled' : ''} title="Odbierz 1 punkt">–</button>
    <button class="charSpend-btn" data-spend-pool="${poolKey}" data-spend-path="${fieldPath}" data-spend-delta="1" ${available <= 0 ? 'disabled' : ''} title="Wydaj 1 punkt">+</button>
    `;
}

/** Charakterystyki — single perk-only value per stat. Forma/Bystrość/Siła Woli also get +/- spenders for Punkty Charakterystyki. */
function renderCharacteristicsSection() {
    const rows = CHARACTERISTICS_CONFIG.map(cfg => {
        const fieldPath = `characteristics.${cfg.key}`;
        const { value, isModified, modifiers } = computeStatValue(CharacterState.characteristics[cfg.key]);
        const title = isModified ? escapeHtml(modifierBreakdown(modifiers)) : '';
        const spendable = CHARACTERISTIC_POOL && CHARACTERISTIC_POOL.allowedCharacteristics.includes(cfg.key);

        return `
        <tr>
        <td class="charTable-rowLabel">${escapeHtml(cfg.label)}</td>
        <td>
        <span class="charStat-readonly" ${title ? `title="${title}"` : ''}>${value}</span>
        ${spendable ? renderPointSpender('characteristicPoints', fieldPath) : ''}
        </td>
        </tr>
        `;
    }).join('');

    return `
    <section class="charSection charSection-half">
    <h2 class="charSection-title">Charakterystyki</h2>
    <table class="charTable charTable-characteristics">
    <thead><tr><th>Charakterystyka</th><th>Wartość</th></tr></thead>
    <tbody>${rows}</tbody>
    </table>
    </section>
    `;
}

/**
 * Umiejętności — each ability has two independent perk-only tracks,
 * each spendable from its own pool:
 *   Doświadczenie (Experience) — a plain number, spent from Punkty Doświadczenia
 *   Improwizacja (Improvisation) — a 1-6 level, spent from Punkty Improwizacji
 */
function renderAbilitiesSection() {
    const rows = ABILITIES_CONFIG.map(cfg => {
        const ability = CharacterState.abilities[cfg.key];
        const expPath    = `abilities.${cfg.key}.experience`;
        const improvPath = `abilities.${cfg.key}.improvisation`;
        const exp    = computeStatValue(ability.experience);
        const improv = computeStatValue(ability.improvisation);
        const expTitle    = exp.isModified    ? escapeHtml(modifierBreakdown(exp.modifiers))    : '';
        const improvTitle = improv.isModified ? escapeHtml(modifierBreakdown(improv.modifiers)) : '';

        return `
        <tr>
        <td class="charTable-rowLabel">${escapeHtml(cfg.label)}</td>
        <td>
        <span class="charStat-readonly" ${expTitle ? `title="${expTitle}"` : ''}>${exp.value}</span>
        ${renderPointSpender('skillExperiencePoints', expPath)}
        </td>
        <td>
        <span class="charStat-readonly" ${improvTitle ? `title="${improvTitle}"` : ''}>${formatImprovisation(improv.value)}</span>
        ${renderPointSpender('skillImprovisationPoints', improvPath)}
        </td>
        </tr>
        `;
    }).join('');

    return `
    <section class="charSection charSection-half">
    <h2 class="charSection-title">Umiejętności</h2>
    <table class="charTable charTable-abilities">
    <thead><tr><th>Umiejętność</th><th>Dośw.</th><th>Improw.</th></tr></thead>
    <tbody>${rows}</tbody>
    </table>
    </section>
    `;
}

/**
 * Wprawa — perk-only, like Charakterystyki/Umiejętności, but its
 * entries aren't a fixed config list: a perk can grant a level in any
 * named Wprawa (see characterState.js's 'proficiency' EFFECT_TYPES
 * entry). Only entries with a level > 0 are shown — an entry with no
 * active modifiers left (e.g. its granting perk was deactivated) just
 * drops out of the list rather than showing "—".
 */
function renderProficienciesSection() {
    return `
    <section class="charSection">
    <h2 class="charSection-title">Wprawa</h2>
    <div id="char-perks-list-wprawa">${renderProficienciesList()}</div>
    <p class="charSection-hint">Wprawa jest przyznawana wyłącznie przez perki.</p>
    </section>
    `;
}

function renderProficienciesList() {
    const entries = Object.entries(CharacterState.proficiencies)
    .map(([name, field]) => ({ name, ...computeStatValue(field) }))
    .filter(e => e.value > 0);

    if (entries.length === 0) {
        return '<p class="charSection-hint">Brak wprawy — aktywuj odpowiednie perki w drzewku umiejętności.</p>';
    }
    return '<ul class="charListRows">' + entries.map(e => {
        const title = e.isModified ? escapeHtml(modifierBreakdown(e.modifiers)) : '';
        return `
        <li class="charListRow">
        <span>${escapeHtml(e.name)}</span>
        <span class="charStat-readonly" ${title ? `title="${title}"` : ''}>${formatImprovisation(e.value)}</span>
        </li>
        `;
    }).join('') + '</ul>';
}

/**
 * Atrybuty — perk-only free-text traits (name + description), NOT
 * numeric like everything else on the sheet. CharacterState.attributes
 * is a plain { [name]: {description, sources} } dict; a name only
 * appears here while at least one perk still grants it (see
 * characterState.js's setAttributeSource()/clearAttributeSource() and
 * perkEffects.js's routing of the 'attribute' effect type). Object
 * keys are unique by construction, so a given name can never appear
 * twice even though multiple perks may be the ones granting it.
 */
function renderAttributesSection() {
    return `
    <section class="charSection">
    <h2 class="charSection-title">Atrybuty</h2>
    <div id="char-attributes-list">${renderAttributesList()}</div>
    <p class="charSection-hint">Atrybuty są przyznawane wyłącznie przez perki.</p>
    </section>
    `;
}

function renderAttributesList() {
    const entries = Object.entries(CharacterState.attributes);

    if (entries.length === 0) {
        return '<p class="charSection-hint">Brak atrybutów — aktywuj odpowiednie perki w drzewku umiejętności.</p>';
    }
    return '<ul class="charListRows charListRows-attributes">' + entries.map(([name, entry]) => `
    <li class="charListRow charListRow-attribute">
    <span class="charAttribute-name">${escapeHtml(name)}</span>
    <span class="charAttribute-desc">${escapeHtml(entry.description)}</span>
    </li>
    `).join('') + '</ul>';
}

function renderPerksSection() {
    return `
    <section class="charSection">
    <h2 class="charSection-title">Wybrane Perki</h2>
    <div id="char-perks-list">${renderPerksList()}</div>
    </section>
    `;
}

function renderPerksList() {
    if (CharacterState.perksTaken.length === 0) {
        return '<p class="charSection-hint">Brak wybranych perków — aktywuj węzły w drzewku umiejętności.</p>';
    }
    return '<ul class="charListRows">' + CharacterState.perksTaken.map(p => `
    <li class="charListRow"><span>${escapeHtml(p.name)}</span></li>
    `).join('') + '</ul>';
}

function modifierBreakdown(modifiers) {
    return modifiers.map(m => `${m.label || m.sourceId}: ${m.amount > 0 ? '+' : ''}${m.amount}`).join('\n');
}


// ============================================================
// Event wiring (delegated on rootEl — attached once per render)
// ============================================================
function attachHandlers() {
    rootEl.querySelector('#char-print-btn').addEventListener('click', () => window.print());
    rootEl.querySelector('#char-reset-btn').addEventListener('click', () => {
        if (window.confirm('Zresetować cały arkusz postaci? Tej operacji nie można cofnąć.')) {
            resetCharacterState();
            render();
        }
    });

    // ---- Header ----
    rootEl.querySelector('#char-name').addEventListener('input', (e) => {
        CharacterState.name = e.target.value;
        saveCharacterState();
    });

    // "Potencjał" — the max perk-point budget. "Dostępny Potencjał" is
    // read-only and derived, so it's just patched here rather than
    // wired as its own input. setPotentialTotal() clamps to the
    // MIN_POTENTIAL floor internally and refuses (returning false) any
    // value that would drop below what's already spent — in that case
    // the input snaps back to the last valid value.
    const potentialInput     = rootEl.querySelector('#char-potential-total');
    const potentialAvailable = rootEl.querySelector('#char-potential-available');
    potentialInput.addEventListener('input', (e) => {
        const ok = setPotentialTotal(e.target.value);
        if (!ok) {
            e.target.value = CharacterState.potential.total;
        }
        potentialAvailable.textContent = computePotentialAvailable();
    });

    // ---- Resources ("current" only — "max" is derived from Charakterystyki) ----
    rootEl.querySelectorAll('.charResource-input').forEach((input) => {
        input.addEventListener('input', (e) => {
            const { resource } = e.target.dataset;
            CharacterState.resources[resource].current = Number(e.target.value) || 0;
            saveCharacterState();
        });
    });

    // ---- Damage table ----
    rootEl.querySelectorAll('.dmgTable-input').forEach((input) => {
        input.addEventListener('input', (e) => {
            const { dmgRow, dmgCol } = e.target.dataset;
            CharacterState.damage[dmgRow][dmgCol] = Number(e.target.value) || 0;
            saveCharacterState();
            rootEl.querySelector('#char-dmg-total').textContent = computeDamageTotal();
        });
    });

    // ---- Point pool spending (Charakterystyki + Umiejętności +/- buttons) ----
    // A full re-render is needed (not just a local DOM patch) because spending
    // from a pool changes that pool's "available" balance everywhere it's
    // shown, not just next to the field that was just clicked.
    rootEl.querySelectorAll('[data-spend-pool]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const { spendPool, spendPath, spendDelta } = btn.dataset;
            if (adjustPoolAllocation(spendPool, spendPath, Number(spendDelta))) render();
        });
    });
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

