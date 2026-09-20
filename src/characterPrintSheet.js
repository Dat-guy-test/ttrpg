// ============================================================
// CHARACTER PRINT SHEET
//
// Builds the readable, paginated "Karta Postaci" print layout (the
// one that used to be a hand-filled static HTML file) from LIVE
// CharacterState / equipment / spell data, and opens it in a new
// browser tab/window so the browser's own print dialog can be used
// on it — completely separate from the on-screen Character Data tab,
// which stays exactly as-is for editing.
//
// Exports:
//   printCharacterSheet() — called by characterSheet.js's "Drukuj"
//                            button instead of window.print().
// ============================================================

import {
    CharacterState, computeStatValue, computeUdzwigValue, computeResourceMax, computeDamageTotal,
    computePotentialAvailable, ABILITIES_CONFIG, DAMAGE_ROWS_CONFIG, formatImprovisation,
} from './characterState.js';
import { getOwnedItems, getItemState, formatItemPrice, getCurrency, formatCurrencyParts } from './equipmentState.js';
import { DAMAGE_TYPES, ATTACK_MODE_TYPES, HANDEDNESS_OPTIONS, formatDiceExpression } from './itemSchema.js';
import { getKnownSpells } from './spellState.js';

// ---- small helpers --------------------------------------------------------

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function labelOf(list, value) {
    const entry = list.find(o => o.value === value);
    return entry ? entry.label : (value || '');
}

/** A filled or blank "box" cell, same visual language as the original static template. */
function box(content = '') {
    return `<div class="box">${escapeHtml(content)}</div>`;
}

function slashCell(a, b) {
    return `<div class="slash-cell">${box(a)}<span class="sep">/</span>${box(b)}</div>`;
}

function pipeCell(a, b) {
    return `<div class="pipe-cell">${box(a)}<div class="sep"></div>${box(b)}</div>`;
}

/** Pads `rows` (array of <tr> strings) with extra blank rows up to `min`, or returns it as-is if already longer. */
function padRows(rows, min, blankRow) {
    const out = [...rows];
    while (out.length < min) out.push(blankRow);
    return out;
}

const BLANK_LINE = '<div class="blank-line"></div>';

// ============================================================
// Data gathering
// ============================================================

function gatherData() {
    const owned = getOwnedItems();
    const equipped = owned.filter(i => getItemState(i.id) === 'equipped');
    const equippedWeapons = equipped.filter(i => i.type === 'weapon');
    const armourLevel = equipped
        .filter(i => i.type === 'armour')
        .reduce((sum, i) => sum + (Number(i.armourLevel) || 0), 0);

    return {
        name: CharacterState.name,
        potentialTotal: CharacterState.potential.total,
        potentialAvailable: computePotentialAvailable(),

        apCurrent: CharacterState.resources.actionPoints.current,
        apMax: computeResourceMax('actionPoints').value,
        epCurrent: CharacterState.resources.energyPoints.current,
        epMax: computeResourceMax('energyPoints').value,
        enduranceCurrent: computeDamageTotal(),
        enduranceMax: computeResourceMax('endurance').value,
        speedMax: computeStatValue(CharacterState.characteristics.szybkosc).value,
        udzwigMax: computeUdzwigValue().value,
        bulkCurrent: owned.reduce((sum, i) => sum + (Number(i.bulk) || 0) * i.quantity, 0),

        armourLevel,
        equippedNames: equipped.map(i => i.name).join(', '),

        damageRows: DAMAGE_ROWS_CONFIG.map(cfg => ({
            label: cfg.label,
            zal: CharacterState.damage[cfg.key].zal,
            nZal: CharacterState.damage[cfg.key].nZal,
        })),
        damageTotal: computeDamageTotal(),
        // True only if at least one damage cell is non-zero. When false the
        // damage table is printed with empty (but full-height) boxes.
        hasDamage: DAMAGE_ROWS_CONFIG.some(cfg =>
            (Number(CharacterState.damage[cfg.key].zal) || 0) !== 0 ||
            (Number(CharacterState.damage[cfg.key].nZal) || 0) !== 0
        ),

        currency: formatCurrencyParts(getCurrency()),

        proficiencies: Object.entries(CharacterState.proficiencies)
            .map(([name, field]) => ({ name, ...computeStatValue(field) }))
            .filter(e => e.value > 0)
            .map(e => ({ name: e.name, dice: formatImprovisation(e.value + 1) })),

        abilities: ABILITIES_CONFIG.map(cfg => {
            const ability = CharacterState.abilities[cfg.key];
            return {
                label: cfg.label,
                exp: computeStatValue(ability.experience).value,
                improv: formatImprovisation(computeStatValue(ability.improvisation).value),
            };
        }),

        spells: getKnownSpells().map(s => ({
            name: s.name,
            energy: s.invocationCost ?? 0,
            actionPoints: s.actionPointCost ?? 0,
            desc: s.desc || '',
        })),

        weapons: equippedWeapons.map(w => ({
            name: w.name,
            block: w.block ?? 0,
            deflection: w.deflection ?? 0,
            proficiencyCategory: w.proficiencyCategory || '',
            attackModes: (w.attackModes || []).map(m => ({
                name: m.name,
                accuracy: m.baseAccuracy,
                minRange: m.minRange,
                effRange: m.effectiveRange ?? '',
                maxRange: m.maxRange,
                damage: (m.damage || []).map(formatDiceExpression).join(', ') || '—',
                damageTypes: [...new Set((m.damage || []).map(d => labelOf(DAMAGE_TYPES, d.type)))].join(', '),
                modeType: labelOf(ATTACK_MODE_TYPES, m.modeType),
                handedness: labelOf(HANDEDNESS_OPTIONS, m.handedness),
            })),
        })),

        attributes: Object.entries(CharacterState.attributes).map(([name, entry]) => ({
            name, description: entry.description,
        })),

        items: owned.map(i => ({
            name: i.name,
            quantity: i.quantity,
            note: formatItemPrice(i.price),
        })),
    };
}

// ============================================================
// HTML builders for repeated sections
// ============================================================

function proficiencyRows(data) {
    const rows = data.proficiencies.map(p => `
        <tr><td class="lbl">${escapeHtml(p.name)}</td><td class="center">${escapeHtml(p.dice)}</td></tr>
    `);
    return padRows(rows, 5, `<tr><td>${BLANK_LINE}</td><td>${BLANK_LINE}</td></tr>`).join('');
}

function abilityRows(list) {
    return list.map(a => `
        <tr><td class="lbl">${escapeHtml(a.label)}</td><td>${pipeCell(a.exp, a.improv)}</td></tr>
    `).join('');
}

function spellRows(data) {
    const rows = data.spells.map(s => `
        <tr><td class="lbl">${escapeHtml(s.name)}</td><td class="center">${escapeHtml(s.energy)}</td><td class="center">${escapeHtml(s.actionPoints)}</td><td>${escapeHtml(s.desc)}</td></tr>
    `);
    return padRows(rows, 6, `<tr><td>${BLANK_LINE}</td><td>${BLANK_LINE}</td><td>${BLANK_LINE}</td><td>${BLANK_LINE}</td></tr>`).join('');
}

function itemRows(data) {
    const rows = data.items.map(i => `
        <tr><td class="lbl">${escapeHtml(i.name)}</td><td class="center">${i.quantity}</td><td>${escapeHtml(i.note)}</td></tr>
    `);
    return padRows(rows, 8, `<tr><td>${BLANK_LINE}</td><td>${BLANK_LINE}</td><td>${BLANK_LINE}</td></tr>`).join('');
}

function attributeRows(data) {
    const rows = data.attributes.map(a => `
        <div class="attr-row"><div class="attr-name">${escapeHtml(a.name)}</div><div class="attr-desc">${escapeHtml(a.description)}</div></div>
    `);
    return padRows(rows, 6, `<div class="attr-row"><div class="attr-name">Nazwa:</div><div class="attr-desc">Opis:</div></div>`).join('');
}

/** Every weapon block prints at least this many attack-mode rows (blank ones fill in). */
const MIN_ATTACK_MODE_ROWS = 3;

function attackModeRows(modes) {
    const rows = modes.slice(0, 5).map((m, i) => `
        <tr>
            <td class="lbl-col">${i + 1}. ${escapeHtml(m.name)}</td>
            <td>${m.accuracy}</td>
            <td>${m.minRange}</td>
            <td>${escapeHtml(String(m.effRange))}</td>
            <td>${m.maxRange}</td>
            <td>${escapeHtml(m.damage)}</td>
            <td>${escapeHtml(m.damageTypes)}</td>
            <td>${escapeHtml(m.modeType)}</td>
            <td>${escapeHtml(m.handedness)}</td>
        </tr>
    `);
    return padRows(rows, MIN_ATTACK_MODE_ROWS, `<tr><td class="lbl-col"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
}

function weaponBlock(weapon) {
    const w = weapon || { name: '', block: '', deflection: '', proficiencyCategory: '', attackModes: [] };
    return `
    <div class="weapon-block">
      <div class="weapon-title-row">
        <div class="weapon-name"><div class="field-label">Nazwa Broni</div><div class="line-field">${escapeHtml(w.name)}</div></div>
        <div class="stat-mini"><div class="field-label">Blokowanie</div>${box(w.block)}</div>
        <div class="stat-mini"><div class="field-label">Odbijanie</div>${box(w.deflection)}</div>
      </div>
      <div class="field-label" style="margin-bottom:0.5mm;">Kategoria Wprawy</div>
      <div class="line-field" style="margin-bottom:1.5mm;">${escapeHtml(w.proficiencyCategory)}</div>
      <table class="attack-table">
        <tr>
          <th class="lbl-col">Tryb Ataku</th>
          <th>Celność</th>
          <th>Zas.<br>Min</th>
          <th>Zas.<br>Skut.</th>
          <th>Zas.<br>Maks</th>
          <th>Obrażenia</th>
          <th>Typ Obr.</th>
          <th>Typ<br>Trybu</th>
          <th>Rodzaj<br>Ataku</th>
        </tr>
        ${attackModeRows(w.attackModes)}
      </table>
    </div>
    `;
}

// ============================================================
// Top-level HTML
// ============================================================

const PRINT_CSS = `
  @page { size: A4; margin: 9mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    background: #fff;
    margin: 0;
    font-size: 16px; /* never below 15px — small text is hard to read on paper */
  }
  .page {
    width: 192mm;
    min-height: 279mm;
    margin: 0 auto;
    page-break-after: always;
    position: relative;
  }
  .page:last-child { page-break-after: auto; }
  .page-fill { display: flex; flex-direction: column; } /* lets the Notatki box stretch to the page bottom */

  h1 {
    font-size: 18px;
    text-align: center;
    margin: 0 0 4mm 0;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  h2 {
    font-size: 17px;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 3mm 0 1mm 0;
    border-bottom: 1.2px solid #000;
    padding-bottom: 1px;
  }
  .star { font-size: 16px; }

  .header-row { display: flex; align-items: flex-end; gap: 4mm; margin-bottom: 3mm; }
  .name-field { flex: 1; }
  .name-field .line { border-bottom: 1.2px solid #000; min-height: 7mm; line-height: 1.25; font-size: 16px; padding: 0 1mm 1px; }
  .field-label { font-size: 16px; text-transform: uppercase; letter-spacing: .5px; }
  .potential-box { width: 16mm; text-align: center; }
  .potential-box .box { border: 1.2px solid #000; height: 6mm; font-size: 16px; display:flex; align-items:center; justify-content:center; }

  table { border-collapse: collapse; width: 100%; }
  td, th {
    border: 0.8px solid #000;
    padding: 0.6px 2px;
    font-size: 16px;
    vertical-align: middle;
  }
  th { font-weight: bold; text-align: left; background: #f2f2f2; }
  .lbl { text-align: left; white-space: nowrap; }
  .center { text-align: center; }
  .slash-cell { display: flex; align-items: center; justify-content: center; gap: 2mm; }
  .slash-cell .box { flex: 1; height: 4mm; border: 0.8px solid #000; display:flex; align-items:center; justify-content:center; }
  .slash-cell .sep { font-weight: bold; }
  .pipe-cell { display: flex; align-items: stretch; justify-content: center; }
  .pipe-cell .box { flex: 1; height: 3.6mm; display:flex; align-items:center; justify-content:center; }
  .pipe-cell .sep { border-left: 0.8px solid #000; margin: 0 1mm; }

  .two-col { display: flex; gap: 4mm; }
  .two-col > div { flex: 1; }

  .armor-panel { display: flex; flex-direction: column; align-items: center; border: 1.2px solid #000; padding: 1.5mm; }
  .armor-panel .field-label { text-align: center; margin-bottom: 0.5mm; }
  .armor-panel svg { display: block; margin: 0 auto; }
  .armor-panel .armour-level-num { font-size: 16px; font-weight: bold; margin-top: -46px; margin-bottom: 30px; }
  .armor-panel .equip-box { width: 100%; margin-top: 2mm; }
  .armor-panel .equip-box .line { border-bottom: 0.8px solid #000; min-height: 7mm; line-height: 1.25; margin-top: 1mm; font-size: 16px; padding: 0 1mm 1px; }

  .blank-line-row td { height: 4.4mm; }
  .blank-line { border-bottom: 0.7px solid #000; height: 3.2mm; font-size: 16px; padding: 0 1mm; }
  /* Underlined field that may hold text: grows with its content (min-height + line-height),
     so the underline can never overlap the text like a fixed-height line would. */
  .line-field { border-bottom: 0.8px solid #000; min-height: 7mm; line-height: 1.25; font-size: 16px; padding: 0 1mm 1px; }

  .weapon-block { border: 1.2px solid #000; padding: 1.5mm; margin-bottom: 3mm; width: 100%; break-inside: avoid; page-break-inside: avoid; }
  .weapon-title-row { display: flex; gap: 3mm; align-items: flex-end; margin-bottom: 1.5mm; }
  .weapon-name { flex: 2; }
  .stat-mini { flex: 1; text-align: center; }
  .stat-mini .box { border: 0.8px solid #000; height: 7mm; display:flex; align-items:center; justify-content:center; font-size: 16px; }

  .attack-table th, .attack-table td { font-size: 16px; padding: 0.5px 1px; text-align: center; }
  /* Fixed minimum row height so empty attack-mode rows stay writable instead of collapsing. */
  .attack-table td { height: 9mm; }
  .attack-table td.lbl-col, .attack-table th.lbl-col { text-align: left; }

  .attr-row { display: flex; gap: 2mm; margin-bottom: 1.5mm; align-items: flex-start;}
  .attr-name { width: 30mm; font-size: 16px; border-bottom: 0.8px solid #000; padding-bottom: 3mm; }
  .attr-desc { flex: 1; border-bottom: 0.8px solid #000; padding-bottom: 3mm; font-size: 16px; }

  .items-table td, .items-table th { font-size: 16px; }

  .currency-table { margin-bottom: 3mm; }
  .currency-table th { text-align: center; }
  .currency-table td { text-align: center; height: 7mm; font-weight: bold; }

  .notes-box { border: 1.2px solid #000; flex: 1; margin-top: 2mm; min-height: 20mm; position: relative; }
  .notes-box .field-label { position: absolute; top: 1mm; left: 1.5mm; }
`;

// ============================================================
// PAGE LAYOUT — this is what decides how many pages are printed
// ------------------------------------------------------------
// Each printed page is ONE <div class="page"> returned by one of
// the page*() functions below, and PAGES (further down) is the
// ordered list of those functions. The page count is simply
// PAGES.length — add/remove/reorder entries to change it.
// (.page in PRINT_CSS forces a page break after every page div.)
//
//   Page 1  pageStats()            — name/potential, Charakterystyki,
//                                    armour level, Otrzymane Obrażenia,
//                                    Wprawy, Umiejętności
//   Page 2  pageSpellsAttributes() — Czary i Zdolności, Atrybuty
//   Page 3  pageWeapons()          — Ulubione Bronie (stacked, full width)
//   Page 4  pageEquipment()        — Historia Postaci, Ekwipunek
//                                    (currency + items), Notatki
//
// Page 2 and page 3 hold the parts whose length depends on the
// character (spell/attribute descriptions, number of weapons), so
// they have their own page. If one of them gets longer than a page
// the browser will flow the extra content onto an additional sheet.
// ============================================================

const TITLE = '<h1>&#9733; Karta Postaci &#9733;</h1>';

function pageStats(data) {
    return `
<div class="page">
  ${TITLE}

  <div class="header-row">
    <div class="name-field">
      <div class="field-label">Imię Postaci</div>
      <div class="line">${escapeHtml(data.name)}</div>
    </div>
    <div class="potential-box">
      <div class="field-label">Całk. P.P.</div>
      ${box(data.potentialTotal)}
    </div>
    <div class="potential-box">
      <div class="field-label">Dost. P.P.</div>
      ${box(data.potentialAvailable)}
    </div>
  </div>

  <h2>Charakterystyki</h2>
  <div class="two-col" style="align-items:flex-start;">
    <div style="flex:1.7;">
      <table>
        <tr><th style="width:50%">Cecha</th><th>Aktualne&nbsp;/&nbsp;Maksymalne</th></tr>
        <tr><td class="lbl">Punkty Akcji / Bystrość</td><td>${slashCell('', data.apMax)}</td></tr>
        <tr><td class="lbl">Punkty Energii / Siła Woli</td><td>${slashCell('', data.epMax)}</td></tr>
        <tr><td class="lbl">Wytrzymałość / Forma</td><td>${slashCell('', data.enduranceMax)}</td></tr>
        <tr><td class="lbl">Ruch / Szybkość</td><td>${slashCell('', data.speedMax)}</td></tr>
        <tr><td class="lbl">Obciążenie / Udźwig</td><td>${slashCell(Math.round(data.bulkCurrent * 100) / 100, data.udzwigMax)}</td></tr>
      </table>
    </div>
    <div style="flex:1;" class="armor-panel">
      <div class="field-label">Poziom Pancerza</div>
      <svg width="60" height="66" viewBox="0 0 60 66" xmlns="http://www.w3.org/2000/svg">
        <path d="M30 2 L56 12 V32 C56 48 44 58 30 64 C16 58 4 48 4 32 V12 Z" fill="none" stroke="#000" stroke-width="1.5"/>
      </svg>
      <div class="armour-level-num">${escapeHtml(data.armourLevel)}</div>
      <div class="equip-box">
        <div class="field-label">Wyposażony Przedmiot / Przedmioty</div>
        <div class="line">${escapeHtml(data.equippedNames)}</div>
        <div class="line"></div>
      </div>
    </div>
  </div>

  <div class="two-col" style="margin-top:2mm;">
    <div style="flex:0.85;">
      <h2>Otrzymane Obrażenia</h2>
      <table>
        <tr><th style="width:60%">Rodzaj Obrażeń</th><th>Zaleczone | Niezaleczone</th></tr>
        ${data.damageRows.map(r => `<tr><td class="lbl">${escapeHtml(r.label)}</td><td>${data.hasDamage ? pipeCell(r.zal, r.nZal) : pipeCell('', '')}</td></tr>`).join('')}
        <tr><td class="lbl"><b>Łącznie</b></td><td>${pipeCell('', data.hasDamage ? data.damageTotal : '')}</td></tr>
      </table>
    </div>

    <div style="flex:1;">
      <h2>Wprawy</h2>
      <table>
        <tr><th style="width:55%">Nazwa kategorii broni / narzędzii</th><th>Poziom wprawy (rzucana kość)</th></tr>
        ${proficiencyRows(data)}
      </table>
    </div>
  </div>

  <h2>Umiejętności</h2>
  <div class="two-col" style="gap:2mm;">
    <table>
      <tr><th style="width:62%">Umiejętność</th><th> P. Doświadczenia | P. Improwizacji</th></tr>
      ${abilityRows(data.abilities.slice(0, 10))}
    </table>
    <table>
      <tr><th style="width:62%">Umiejętność</th><th>P. Doświadczenia | P. Improwizacji</th></tr>
      ${abilityRows(data.abilities.slice(10))}
    </table>
  </div>

</div>
`;
}

function pageSpellsAttributes(data) {
    return `
<div class="page">
  ${TITLE}

  <h2>Czary i Zdolności</h2>
  <table>
    <tr><th>Nazwa</th><th style="width:9%">Punkty Energii</th><th style="width:9%">Punkty Akcji</th><th>Opis</th></tr>
    ${spellRows(data)}
  </table>

  <h2>Atrybuty</h2>
  ${attributeRows(data)}

</div>
`;
}

function pageWeapons(data) {
    // Every equipped weapon gets its own full-width block, stacked vertically.
    // With fewer than 2 equipped weapons, blank blocks (each with
    // MIN_ATTACK_MODE_ROWS empty, fixed-height attack-mode rows) fill in
    // so the player can write their favourite weapons by hand.
    const weaponList = [...data.weapons];
    while (weaponList.length < 2) weaponList.push(null);

    return `
<div class="page">
  ${TITLE}

  <h2>&#9733; Ulubione Bronie &#9733;</h2>
  ${weaponList.map(weaponBlock).join('')}
</div>
`;
}

function pageEquipment(data) {
    return `
<div class="page page-fill">
  ${TITLE}

  <h2>Ekwipunek</h2>
  <table class="currency-table">
    <tr><th>Sztuki Konstancjum</th><th>Pierścienie Konstancjum</th><th>Nitki Konstancjum</th></tr>
    <tr><td>${data.currency.pieces}</td><td>${data.currency.rings}</td><td>${data.currency.strands}</td></tr>
  </table>
  <table class="items-table">
    <tr><th style="width:55%">Przedmiot</th><th style="width:15%">Ilość</th><th style="width:30%">Uwagi</th></tr>
    ${itemRows(data)}
  </table>

  <div class="notes-box">
    <div class="field-label">&#9733; Notatki &#9733;</div>
  </div>

</div>
`;
}

/** Ordered list of printed pages — its length IS the page count. */
const PAGES = [pageStats, pageSpellsAttributes, pageWeapons, pageEquipment];

function buildHtml(data) {
    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Karta Postaci${data.name ? ' — ' + escapeHtml(data.name) : ''}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${PAGES.map(page => page(data)).join('\n')}
</body>
</html>`;
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Builds the printable "Karta Postaci" layout from the character's
 * current live state and opens it in a new tab/window with the
 * browser's print dialog invoked automatically. Falls back to just
 * leaving the tab open (with an alert) if the popup was blocked.
 */
export function printCharacterSheet() {
    const data = gatherData();
    const html = buildHtml(data);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        window.alert('Nie udało się otworzyć okna wydruku — sprawdź, czy przeglądarka nie zablokowała wyskakującego okna.');
        return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.focus();
    // Wait a tick so the new document (fonts/layout) is actually ready
    // before invoking print — calling print() synchronously right after
    // document.write() can race the layout in some browsers.
    printWindow.setTimeout(() => {
        printWindow.print();
    }, 250);
}
