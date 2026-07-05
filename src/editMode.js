// ============================================================
// EDIT MODE
//
// Toggleable skill-tree editor with three submodes:
//   select  — click a node to inspect/edit its properties (default)
//   addNode — click the purple debug sphere to place a new node
//   connect — click a dependent node, then its prerequisite, to link them
//
// Regardless of submode, clicking an existing ARC in edit mode asks
// to delete that requirement (see handleEditModeConnectionClick,
// called from Tree.js's createLinesNTubes click handlers).
//
// Exports:
//   initEditMode()                  — builds the (hidden) panel DOM.
//   toggleEditMode()                — flips AppState.editMode, bound to 'E'.
//   handleEditModeNodeClick(node)   — called from TreeNode.onClick.
//   handleTreesphereClick(hit)      — called from Tree.js's treesphere.onClick.
//   handleEditModeConnectionClick(tree, ownerIndex, reqIndex)
//                                    — called from Tree.js's arc click handlers.
//
// This module only imports AppState and characterState.js (for the
// effect-type config) — no local imports back into Tree.js /
// TreeNode.js — so both are free to import THIS module without
// creating a circular import.
//
// Still out of scope (later steps): deleting nodes, editing the
// mutual-exclusion group a node belongs to (this one's actually done
// — see below).
// ============================================================

import AppState from './appState.js';
import { EFFECT_TYPES } from './characterState.js';


let panelEl  = null;
let bodyEl   = null; // re-rendered per selection / submode
let statusEl = null; // small transient status/error message


// ============================================================
// initEditMode
// ============================================================
export function initEditMode() {
    panelEl = document.createElement('div');
    panelEl.id = 'editorPanel';
    panelEl.className = 'editor-panel editor-hidden';

    panelEl.innerHTML = `
        <div class="editor-header">
            <strong>Edit Mode</strong>
            <span class="editor-hint">press <kbd>E</kbd> to toggle</span>
        </div>
        <div class="editor-toolbar" id="editorModeButtons">
            <button class="editor-btn editor-mode-btn" data-mode="select">Select</button>
            <button class="editor-btn editor-mode-btn" data-mode="addNode">Add Node</button>
            <button class="editor-btn editor-mode-btn" data-mode="connect">Connect</button>
            <button class="editor-btn editor-mode-btn" data-mode="deleteNode">Delete Node</button>
        </div>
        <div class="editor-toolbar">
            <button class="editor-btn" id="editorExportBtn">Export nodes.json</button>
        </div>
        <div class="editor-status" id="editorStatus"></div>
        <div class="editor-body" id="editorBody">
            <em>Click a node to inspect it.</em>
        </div>
    `;

    document.body.appendChild(panelEl);
    bodyEl   = panelEl.querySelector('#editorBody');
    statusEl = panelEl.querySelector('#editorStatus');

    panelEl.querySelector('#editorExportBtn').addEventListener('click', exportTreeJSON);
    panelEl.querySelector('#editorModeButtons').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-mode]');
        if (btn) setEditSubMode(btn.dataset.mode);
    });

    updateModeButtons();
}


// ============================================================
// toggleEditMode
// ============================================================
export function toggleEditMode() {
    AppState.editMode = !AppState.editMode;
    AppState.editSubMode = 'select';
    AppState.selectedNode = null;
    AppState.connectSourceNode = null;
    AppState.pendingNewNodePos = null;

    if (panelEl) panelEl.classList.toggle('editor-hidden', !AppState.editMode);
    updateModeButtons();
    setStatus('');
    renderInspector();

    console.log(`Edit mode ${AppState.editMode ? 'ON' : 'OFF'}`);
}


// ============================================================
// setEditSubMode
// ============================================================
function setEditSubMode(mode) {
    AppState.editSubMode = mode;
    AppState.connectSourceNode = null;
    AppState.pendingNewNodePos = null;
    updateModeButtons();

    const hints = {
        select:     'Click a node to inspect and edit it.',
        addNode:    'Click anywhere on the purple sphere to place a new node.',
        connect:    'Click the DEPENDENT node first, then click its PREREQUISITE. Click an existing connection any time to delete it.',
        deleteNode: 'Click a node to delete it (you\'ll be asked to confirm).',
    };
    setStatus(hints[mode] || '');
    renderInspector();
}

function updateModeButtons() {
    if (!panelEl) return;
    panelEl.querySelectorAll('.editor-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === AppState.editSubMode);
    });
}


// ============================================================
// handleEditModeNodeClick
// Routes a node click based on the current submode.
// ============================================================
export function handleEditModeNodeClick(node) {
    if (AppState.editSubMode === 'connect') {
        handleConnectClick(node);
        return;
    }
    if (AppState.editSubMode === 'deleteNode') {
        deleteNodeWithConfirm(node);
        return;
    }
    // 'select' (and 'addNode', if the user happens to click an existing
    // node instead of empty sphere) both just select it for inspection.
    AppState.selectedNode = node;
    AppState.pendingNewNodePos = null;
    setStatus('');
    renderInspector();
}

/** Shared by the deleteNode submode click and the inspector's own Delete button. */
function deleteNodeWithConfirm(node) {
    const ok = window.confirm(`Delete node "${node.nodeName}" (id ${node.nodeId})? This also removes any connections that reference it.`);
    if (!ok) return;

    AppState.tr.removeNode(node.nodeId);
    if (AppState.selectedNode && AppState.selectedNode.nodeId === node.nodeId) {
        AppState.selectedNode = null;
    }
    setStatus(`Deleted "${node.nodeName}".`);
    renderInspector();
}

function handleConnectClick(node) {
    if (!AppState.connectSourceNode) {
        AppState.connectSourceNode = node;
        setStatus(`Dependent node: "${node.nodeName}". Now click its prerequisite.`);
        return;
    }

    const dependent = AppState.connectSourceNode;
    AppState.connectSourceNode = null;

    if (dependent.nodeId === node.nodeId) {
        setStatus('A node can\'t require itself — pick a different prerequisite.', true);
        return;
    }
    const alreadyLinked = dependent.requires.some(req => !Array.isArray(req) && req === node.nodeId);
    if (alreadyLinked) {
        setStatus(`"${dependent.nodeName}" already requires "${node.nodeName}".`, true);
        return;
    }

    AppState.tr.addRequirement(dependent.nodeId, node.nodeId);
    setStatus(`"${dependent.nodeName}" now requires "${node.nodeName}". Click another dependent node to keep connecting.`);

    if (AppState.selectedNode && AppState.selectedNode.nodeId === dependent.nodeId) {
        renderInspector(); // refresh the open inspector if it's showing the node we just changed
    }
}


// ============================================================
// handleTreesphereClick  (addNode submode)
// ============================================================
export function handleTreesphereClick(hit) {
    if (!AppState.editMode || AppState.editSubMode !== 'addNode') return;

    // Nodes sit ON the same sphere surface as this debug sphere, so a
    // click that also hit an actual node fires both handlers off one
    // ray. Treat that as "clicked the node", not "place a node here".
    const alsoHitNode = AppState.intersects.some(i => i.object && i.object.nodeId !== undefined);
    if (alsoHitNode) return;

    const { fiDeg, thetaDeg } = AppState.tr.worldPointToFiTheta(hit.point);
    AppState.pendingNewNodePos = { fiDeg, thetaDeg };
    AppState.selectedNode = null;
    renderInspector();
    setStatus(`Placed at fi=${fiDeg.toFixed(1)}°, theta=${thetaDeg.toFixed(1)}°. Fill in the fields and click "Create Node".`);
}


// ============================================================
// handleEditModeConnectionClick  (arc click → delete, any submode)
// ============================================================
export function handleEditModeConnectionClick(tree, ownerIndex, reqIndex) {
    const owner = tree.nodes[ownerIndex];
    if (!owner || owner.requires[reqIndex] === undefined) return;

    const removed = owner.requires[reqIndex];
    const label = Array.isArray(removed) ? `one of [${removed.join(', ')}]` : removed;
    const ok = window.confirm(`Remove this connection?\n"${owner.nodeName}" requires ${label}`);
    if (!ok) return;

    tree.removeRequirement(owner.nodeId, reqIndex);
    setStatus(`Removed a requirement from "${owner.nodeName}".`);

    if (AppState.selectedNode && AppState.selectedNode.nodeId === owner.nodeId) {
        renderInspector();
    }
}


// ============================================================
// renderInspector — dispatches to the right form for current state
// ============================================================
function renderInspector() {
    if (!bodyEl) return;

    if (AppState.pendingNewNodePos) {
        renderNewNodeForm(AppState.pendingNewNodePos.fiDeg, AppState.pendingNewNodePos.thetaDeg);
        return;
    }
    if (!AppState.selectedNode) {
        bodyEl.innerHTML = '<em>Click a node to inspect it.</em>';
        return;
    }
    renderExistingNodeForm(AppState.selectedNode);
}


// ============================================================
// Effect list — a node can carry any number of effects. Both forms
// below show the current list (with a ✕ per entry) plus a small
// "add one more" mini-form. Adding/removing is applied immediately
// (same live-edit pattern as Requirements) rather than staged behind
// the node's "Save Changes" button.
// ============================================================

/** Options for the "target" dropdown, given a chosen effect type. */
function effectFieldOptions(type) {
    const cfg = EFFECT_TYPES.find(e => e.value === type);
    return cfg ? cfg.options : [];
}

/** Rebuilds a "target" <select>'s options for the given effect type, preserving selectedKey if possible. */
function populateEffectKeyOptions(selectEl, type, selectedKey) {
    const options = effectFieldOptions(type);
    selectEl.innerHTML = options.map(o => `
        <option value="${escapeHtml(o.key)}" ${o.key === selectedKey ? 'selected' : ''}>${escapeHtml(o.label)}</option>
    `).join('');
    selectEl.disabled = options.length === 0;
}

/**
 * Renders the current effects list as removable rows (reuses the
 * Requirements row styling). Most effect types show "Label — Target:
 * ±Amount"; effect types marked `needsDescription` (currently just
 * 'attribute') show "Label — Name: “description text”" instead,
 * since they don't carry a numeric amount at all.
 */
function renderEffectsList(effects) {
    if (!effects || effects.length === 0) return '<em>Brak efektów.</em>';
    return effects.map((eff, i) => {
        const def = EFFECT_TYPES.find(e => e.value === eff.type);
        const defLabel = def ? def.label : eff.type;
        const needsKey = def ? def.needsKey !== false : true;
        // Freeform effects (e.g. 'proficiency', 'attribute') don't resolve
        // against a fixed options list — eff.key IS the display name already.
        const isFreeform = !!(def && def.freeform);
        const needsDescription = !!(def && def.needsDescription);
        const targetLabel = needsKey
            ? (isFreeform
                ? eff.key
                : ((def && def.options.find(o => o.key === eff.key)) || {}).label || eff.key)
            : null;

        let line;
        if (needsDescription) {
            const descText = escapeHtml(eff.description || '');
            line = targetLabel
                ? `${escapeHtml(defLabel)} — ${escapeHtml(targetLabel)}: “${descText}”`
                : `${escapeHtml(defLabel)}: “${descText}”`;
        } else {
            const sign = eff.amount > 0 ? '+' : '';
            line = targetLabel
                ? `${escapeHtml(defLabel)} — ${escapeHtml(targetLabel)}: ${sign}${eff.amount}`
                : `${escapeHtml(defLabel)}: ${sign}${eff.amount}`;
        }

        return `
            <div class="editor-req-row">
                <span>${line}</span>
                <button class="editor-btn editor-btn-small" data-remove-effect="${i}">✕</button>
            </div>
        `;
    }).join('');
}

/**
 * Markup for the "add one more effect" mini-form: type / target /
 * amount (or description) + a button. The "target" slot renders BOTH
 * a <select> (for fixed-option effect types) and a text <input> (for
 * freeform ones, e.g. 'proficiency', 'attribute'); the description
 * textarea and the amount input are both always present in the DOM
 * and toggled by wireAddEffectForm() below based on the chosen type's
 * `freeform` / `needsAmount` / `needsDescription` flags.
 */
function addEffectFormTemplate(idPrefix) {
    return `
        <div class="editor-row">
            <div>
                <select id="${idPrefix}-add-effect-type">
                    <option value="">Wybierz typ…</option>
                    ${EFFECT_TYPES.map(t => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join('')}
                </select>
            </div>
            <div>
                <select id="${idPrefix}-add-effect-key"></select>
                <input id="${idPrefix}-add-effect-key-text" type="text" placeholder="Nazwa…" style="display:none;" />
            </div>
        </div>
        <textarea id="${idPrefix}-add-effect-desc" rows="3" placeholder="Opis atrybutu…" style="display:none;"></textarea>
        <div class="editor-row">
            <input id="${idPrefix}-add-effect-amount" type="number" step="1" value="1" placeholder="Ilość" />
            <button class="editor-btn editor-btn-small" id="${idPrefix}-add-effect-btn">Dodaj efekt</button>
        </div>
    `;
}

/**
 * Wires the "add one more effect" mini-form built by addEffectFormTemplate().
 * `onAdd(effect)` is called with a validated effect object once the
 * user clicks the button; validation errors are shown via setStatus().
 *
 * Most effect types target one of a fixed `options` list (a <select>)
 * and carry a numeric `amount`. Types marked `freeform: true` (e.g.
 * 'proficiency', 'attribute') target an arbitrary typed name instead —
 * for those the text input is shown and the select hidden. Types
 * marked `needsAmount: false` (currently just 'attribute') hide the
 * Amount field entirely and omit `amount` from the built effect.
 * Types marked `needsDescription: true` (currently just 'attribute')
 * show an extra description textarea and require non-empty text.
 */
function wireAddEffectForm(idPrefix, onAdd) {
    const typeSelect   = bodyEl.querySelector(`#${idPrefix}-add-effect-type`);
    const keySelect    = bodyEl.querySelector(`#${idPrefix}-add-effect-key`);
    const keyTextInput = bodyEl.querySelector(`#${idPrefix}-add-effect-key-text`);
    const descInput    = bodyEl.querySelector(`#${idPrefix}-add-effect-desc`);
    const amountInput  = bodyEl.querySelector(`#${idPrefix}-add-effect-amount`);
    const addBtn       = bodyEl.querySelector(`#${idPrefix}-add-effect-btn`);

    function currentDef() {
        return EFFECT_TYPES.find(e => e.value === typeSelect.value);
    }

    function updateFieldVisibility() {
        const def = currentDef();
        const isFreeform        = !!(def && def.freeform);
        const needsDescription  = !!(def && def.needsDescription);
        const needsAmount       = !def || def.needsAmount !== false;

        keySelect.style.display    = isFreeform ? 'none' : '';
        keyTextInput.style.display = isFreeform ? '' : 'none';
        if (!isFreeform) populateEffectKeyOptions(keySelect, typeSelect.value, null);

        descInput.style.display   = needsDescription ? '' : 'none';
        amountInput.style.display = needsAmount ? '' : 'none';
    }

    updateFieldVisibility();
    typeSelect.addEventListener('change', updateFieldVisibility);

    addBtn.addEventListener('click', () => {
        const type              = typeSelect.value;
        const def               = currentDef();
        const needsKey          = def ? def.needsKey !== false : true;
        const isFreeform         = !!(def && def.freeform);
        const needsDescription   = !!(def && def.needsDescription);
        const needsAmount        = !def || def.needsAmount !== false;

        const key         = needsKey ? (isFreeform ? keyTextInput.value.trim() : keySelect.value) : null;
        const description = needsDescription ? descInput.value.trim() : null;
        const amount       = needsAmount ? Number(amountInput.value) : null;

        if (!type) { setStatus('Wybierz typ efektu.', true); return; }
        if (needsKey && !key) { setStatus('Wybierz lub wpisz cel efektu.', true); return; }
        if (needsDescription && !description) { setStatus('Ten efekt wymaga opisu.', true); return; }
        if (needsAmount && (!Number.isFinite(amount) || amount === 0)) { setStatus('Efekt wymaga niezerowej wartości „Ilość”.', true); return; }

        const effect = { type, key };
        if (needsAmount) effect.amount = amount;
        if (needsDescription) effect.description = description;

        onAdd(effect);

        if (isFreeform) keyTextInput.value = '';
        if (needsDescription) descInput.value = '';
    });
}


// ============================================================
// Existing-node form (properties + requirements + effect)
// ============================================================
function renderExistingNodeForm(node) {
    const fiDeg    = -node.fi * 180 / Math.PI;
    const thetaDeg =  node.theta * 180 / Math.PI;

    const requiresRows = (node.requires.length === 0)
        ? '<em>No requirements.</em>'
        : node.requires.map((req, i) => {
            const label = Array.isArray(req) ? `OR: ${req.join(', ')}` : `AND: ${req}`;
            return `<div class="editor-req-row">
                <span>${escapeHtml(label)}</span>
                <button class="editor-btn editor-btn-small" data-remove-req="${i}">✕</button>
            </div>`;
        }).join('');

    bodyEl.innerHTML = `
        <div class="editor-field readonly">
            <span class="editor-label">ID</span><span>${escapeHtml(node.nodeId)}</span>
        </div>

        <label class="editor-label" for="ed-name">Name</label>
        <input id="ed-name" type="text" value="${escapeHtml(node.nodeName)}" />

        <label class="editor-label" for="ed-desc">Description (use &lt;D&gt; for line breaks)</label>
        <textarea id="ed-desc" rows="5">${escapeHtml(node.nodeDesc)}</textarea>

        <label class="editor-label" for="ed-hover">Hover text</label>
        <input id="ed-hover" type="text" value="${escapeHtml(node.hovertext)}" />

        <div class="editor-row">
            <div>
                <label class="editor-label" for="ed-cost">Cost</label>
                <input id="ed-cost" type="number" value="${node.nodeCost}" />
            </div>
            <div>
                <label class="editor-label" for="ed-temp">Temperature (K)</label>
                <input id="ed-temp" type="number" value="${node.temperature}" />
            </div>
        </div>

        <div class="editor-row">
            <div>
                <label class="editor-label" for="ed-fi">Fi (deg)</label>
                <input id="ed-fi" type="number" step="0.1" value="${fiDeg.toFixed(2)}" />
            </div>
            <div>
                <label class="editor-label" for="ed-theta">Theta (deg)</label>
                <input id="ed-theta" type="number" step="0.1" value="${thetaDeg.toFixed(2)}" />
            </div>
        </div>

        <div class="editor-row">
            <button class="editor-btn editor-save-btn" id="ed-save">Save Changes</button>
            <button class="editor-btn editor-btn-danger" id="ed-delete">Delete Node</button>
        </div>

        <label class="editor-label">Requirements</label>
        ${requiresRows}
        <div class="editor-row">
            <input id="ed-new-req" type="text" placeholder="id — or id1,id2 for OR" />
            <button class="editor-btn editor-btn-small" id="ed-add-req">Add</button>
        </div>
        <div class="editor-hint">Tip: you can also switch to Connect mode and click nodes directly.</div>

        <label class="editor-label">Efekty perku (wpływ na arkusz postaci)</label>
        <div id="ed-effects-list">${renderEffectsList(node.effects)}</div>
        ${addEffectFormTemplate('ed')}
        <div class="editor-hint">Jeden perk może mieć wiele efektów — dodaj kolejne po kolei. Zmiany są zapisywane od razu, bez „Save Changes”.</div>

        <label class="editor-label" for="ed-exclgroup">Mutual-exclusion group</label>
        <select id="ed-exclgroup">
            <option value="">None</option>
            ${(AppState.tr.mutExclGroups || []).map(g => `
                <option value="${escapeHtml(g.label)}" ${node.excl && node.excl.label === g.label ? 'selected' : ''}>
                    ${escapeHtml(g.label)} (max ${g.max}, ${g.members.length} member${g.members.length === 1 ? '' : 's'})
                </option>
            `).join('')}
            <option value="__new__">+ New group…</option>
        </select>

        <div id="ed-newgroup-wrap" style="display:none;">
            <label class="editor-label" for="ed-newgroup-label">New group label</label>
            <input id="ed-newgroup-label" type="text" placeholder="e.g. origins" />
        </div>

        <label class="editor-label" for="ed-exclmax">Max active in this group</label>
        <input id="ed-exclmax" type="number" min="1" value="${node.excl ? node.excl.max : 1}" />

        <div class="editor-field readonly">
            <span class="editor-label">Current group</span><span>${formatExclGroup(node.excl)}</span>
        </div>
        <div class="editor-field readonly">
            <span class="editor-label">Active</span><span>${node.nodeActive ? 'Yes' : 'No'}</span>
        </div>
    `;

    wireAddEffectForm('ed', (effect) => {
        AppState.tr.addNodeEffect(node.nodeId, effect);
        renderInspector(); // re-render the node form, same as adding a Requirement does today
    });
    bodyEl.querySelectorAll('[data-remove-effect]').forEach(btn => {
        btn.addEventListener('click', () => {
            AppState.tr.removeNodeEffectAt(node.nodeId, Number(btn.dataset.removeEffect));
            renderInspector();
        });
    });

    const exclSelect  = bodyEl.querySelector('#ed-exclgroup');
    const newGroupWrap = bodyEl.querySelector('#ed-newgroup-wrap');
    const maxInput    = bodyEl.querySelector('#ed-exclmax');

    exclSelect.addEventListener('change', () => {
        const val = exclSelect.value;
        newGroupWrap.style.display = (val === '__new__') ? '' : 'none';

        if (val === '__new__' || val === '') {
            maxInput.value = 1;
        } else {
            const g = (AppState.tr.mutExclGroups || []).find(g => g.label === val);
            if (g) maxInput.value = g.max;
        }
    });

    bodyEl.querySelector('#ed-save').addEventListener('click', () => saveNode(node));
    bodyEl.querySelector('#ed-delete').addEventListener('click', () => deleteNodeWithConfirm(node));
    bodyEl.querySelector('#ed-add-req').addEventListener('click', () => addRequirementFromInput(node));
    bodyEl.querySelectorAll('[data-remove-req]').forEach(btn => {
        btn.addEventListener('click', () => {
            AppState.tr.removeRequirement(node.nodeId, Number(btn.dataset.removeReq));
            renderInspector();
        });
    });
}

function saveNode(node) {
    const name  = bodyEl.querySelector('#ed-name').value.trim();
    const desc  = bodyEl.querySelector('#ed-desc').value;
    const hover = bodyEl.querySelector('#ed-hover').value;
    const cost  = Number(bodyEl.querySelector('#ed-cost').value);
    const temp  = Number(bodyEl.querySelector('#ed-temp').value);
    const fiDeg = Number(bodyEl.querySelector('#ed-fi').value);
    const thDeg = Number(bodyEl.querySelector('#ed-theta').value);

    const exclSelectVal = bodyEl.querySelector('#ed-exclgroup').value;
    const newGroupLabel = bodyEl.querySelector('#ed-newgroup-label')?.value.trim() ?? '';
    const exclMax = Number(bodyEl.querySelector('#ed-exclmax').value);

    if (!name) { setStatus('Name can\'t be empty.', true); return; }
    if (!Number.isFinite(cost) || cost < 0) { setStatus('Cost must be a non-negative number.', true); return; }
    if (!Number.isFinite(temp) || temp <= 0) { setStatus('Temperature must be a positive number.', true); return; }
    if (!Number.isFinite(fiDeg) || !Number.isFinite(thDeg)) { setStatus('Fi/theta must be numbers.', true); return; }

    let groupLabel = null;
    if (exclSelectVal === '__new__') {
        if (!newGroupLabel) { setStatus('New group needs a label.', true); return; }
        groupLabel = newGroupLabel;
    } else if (exclSelectVal) {
        groupLabel = exclSelectVal;
    }
    if (groupLabel && (!Number.isFinite(exclMax) || exclMax < 1)) {
        setStatus('Max active must be at least 1.', true); return;
    }

    node.nodeName    = name;
    node.nodeDesc    = desc;
    node.hovertext   = hover;
    node.nodeCost    = cost;
    node.temperature = temp; // doesn't re-tint the already-loaded star texture — cosmetic only on export

    AppState.tr.setNodeExclGroup(node.nodeId, groupLabel, groupLabel ? exclMax : undefined);

    const moved = fiDeg !== (-node.fi * 180 / Math.PI) || thDeg !== (node.theta * 180 / Math.PI);
    if (moved) {
        node.reposition(fiDeg, thDeg);
        AppState.tr.rebuildArcs(); // arc geometry is baked at draw time — redraw so it follows the move
    }

    setStatus(`Saved "${node.nodeName}".${moved ? ' Position updated.' : ''}`);
    renderInspector();
}

function addRequirementFromInput(node) {
    const raw = bodyEl.querySelector('#ed-new-req').value.trim();
    if (!raw) return;

    const entry = raw.includes(',')
        ? raw.split(',').map(s => s.trim()).filter(Boolean)
        : raw;

    const ok = AppState.tr.addRequirement(node.nodeId, entry);
    setStatus(ok ? `Added requirement to "${node.nodeName}".` : 'Could not add that requirement.', !ok);
    renderInspector();
}


// ============================================================
// New-node form (addNode submode)
// ============================================================

// The node doesn't exist yet, so its effects can't be live-edited
// against the tree the way an existing node's can — they're staged
// here and only submitted once "Create Node" is clicked. Reset every
// time the form (re)opens.
let pendingNewNodeEffects = [];

function renderNewNodeForm(fiDeg, thetaDeg) {
    pendingNewNodeEffects = [];

    bodyEl.innerHTML = `
        <div class="editor-field readonly">
            <span class="editor-label">Placing new node at</span>
            <span>fi ${fiDeg.toFixed(2)}°, theta ${thetaDeg.toFixed(2)}°</span>
        </div>

        <label class="editor-label" for="new-id">ID (optional — auto-generated if blank)</label>
        <input id="new-id" type="text" placeholder="e.g. 11" />

        <label class="editor-label" for="new-name">Name</label>
        <input id="new-name" type="text" value="New Node" />

        <label class="editor-label" for="new-desc">Description (use &lt;D&gt; for line breaks)</label>
        <textarea id="new-desc" rows="4"></textarea>

        <label class="editor-label" for="new-hover">Hover text</label>
        <input id="new-hover" type="text" />

        <div class="editor-row">
            <div>
                <label class="editor-label" for="new-cost">Cost</label>
                <input id="new-cost" type="number" value="1" />
            </div>
            <div>
                <label class="editor-label" for="new-temp">Temperature (K)</label>
                <input id="new-temp" type="number" value="6000" />
            </div>
        </div>

        <label class="editor-label">Efekty perku (opcjonalnie)</label>
        <div id="new-effects-list"><em>Brak efektów.</em></div>
        ${addEffectFormTemplate('new')}

        <button class="editor-btn editor-save-btn" id="new-create">Create Node</button>
        <button class="editor-btn" id="new-cancel">Cancel</button>
    `;

    wireAddEffectForm('new', (effect) => {
        pendingNewNodeEffects.push(effect);
        renderPendingEffectsList();
        setStatus('');
    });
    renderPendingEffectsList();

    bodyEl.querySelector('#new-create').addEventListener('click', () => createNodeFromForm(fiDeg, thetaDeg));
    bodyEl.querySelector('#new-cancel').addEventListener('click', () => {
        AppState.pendingNewNodePos = null;
        setStatus('');
        renderInspector();
    });
}

/** Re-renders just the #new-effects-list div (not the whole form) so other typed fields stay intact. */
function renderPendingEffectsList() {
    const listEl = bodyEl.querySelector('#new-effects-list');
    if (!listEl) return;
    listEl.innerHTML = renderEffectsList(pendingNewNodeEffects);
    listEl.querySelectorAll('[data-remove-effect]').forEach(btn => {
        btn.addEventListener('click', () => {
            pendingNewNodeEffects.splice(Number(btn.dataset.removeEffect), 1);
            renderPendingEffectsList();
        });
    });
}

function createNodeFromForm(fiDeg, thetaDeg) {
    const id    = bodyEl.querySelector('#new-id').value.trim();
    const name  = bodyEl.querySelector('#new-name').value.trim();
    const desc  = bodyEl.querySelector('#new-desc').value;
    const hover = bodyEl.querySelector('#new-hover').value;
    const cost  = Number(bodyEl.querySelector('#new-cost').value);
    const temp  = Number(bodyEl.querySelector('#new-temp').value);

    if (!name) { setStatus('Name can\'t be empty.', true); return; }
    if (!Number.isFinite(cost) || cost < 0) { setStatus('Cost must be a non-negative number.', true); return; }
    if (!Number.isFinite(temp) || temp <= 0) { setStatus('Temperature must be a positive number.', true); return; }

    const node = AppState.tr.addNode({
        id, name, desc, hoverText: hover, cost, temperature: temp, fi: fiDeg, theta: thetaDeg,
        effects: pendingNewNodeEffects,
    });
    if (!node) { setStatus(`Couldn't create node — id "${id}" is already taken.`, true); return; }

    AppState.editSubMode = 'select';
    AppState.pendingNewNodePos = null;
    AppState.selectedNode = node;
    updateModeButtons();
    setStatus(`Created "${node.nodeName}" (id ${node.nodeId}). Link it up in Connect mode or below.`);
    renderInspector();
}


// ============================================================
// Export
// ============================================================
function exportTreeJSON() {
    if (!AppState.tr) { setStatus('Tree isn\'t loaded yet.', true); return; }

    const data = AppState.tr.toJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'nodes.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus('Exported nodes.json — replace the file in your project and commit it.');
}


// ============================================================
// Small helpers
// ============================================================

function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle('editor-status-error', !!isError);
}

/** Renders a node's shared mutual-exclusion group object, if any. */
function formatExclGroup(group) {
    if (!group) return 'None';
    const members = Array.isArray(group.members) ? group.members.join(', ') : '(invalid members list — check nodes.json)';
    return `"${group.label}" (max ${group.max} active, members: ${members})`;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

