// ============================================================
// TreeNode  (extends THREE.Mesh)
//
// Represents a single perk / skill in the skill tree.
// Each instance owns:
//   • An invisible sphere (the Mesh itself) — raycaster hit target
//   • A small star mesh      — visible glowing dot, added to bloom
//   • A 3D text label mesh   — node name, tangent to the sphere
//   • A StarModel            — async lava-shader, applied on activation
//
// Formerly-global variables (scene, camera, tr, panCamBool, …) are
// all accessed through AppState. computePanCamera() is imported
// from cameraControls.js.
//
// Note: addToBloom is inlined here (two lines) to avoid a circular
// import with sceneSetup.js — TreeNode is imported by Tree.js which
// is imported by main.js which imports sceneSetup.js.
//
// `requires` format (post-JSON-migration): an array whose entries
// are each either a plain id string (AND) or an array of id strings
// (OR group) — see the header comment in Tree.js for details.
//
// `exclStuff` (stored as `this.excl`) is either null or a shared
// group object { label, max, members }, built once in Tree's
// treeGen() and referenced by every member node.
//
// `effects` (stored as `this.effects`) is an array — possibly empty —
// of { type, key, amount } entries describing what this node does to
// the Character Data tab when active. See perkEffects.js and
// characterState.js's EFFECT_TYPES. applyNodeEffect()/removeNodeEffect()
// are called from onClick() below, on activation/deactivation.
//
// A node whose effects include granted currency/items can only be
// DEACTIVATED while the player still has at least as much of that
// currency/item as was originally granted — see perkEffects.js's
// canRevokeNodeEffect().
//
// ------------------------------------------------------------
// PLAYER CHOICES ON ACTIVATION
// ------------------------------------------------------------
// A node with an 'attributeChoice' / 'spellSchoolUnlock' effect asks the
// player to pick from a list (choiceDialog.js — a modal with search/
// filters, checkboxes and description-on-hover). onClick() is therefore
// async: once every normal activation check has passed, it awaits
// perkEffects.js's collectNodeChoices() BEFORE flipping nodeActive. If the
// player presses "Zrezygnuj z wybierania tego atrybutu" the result is
// null and the node is simply never activated (it stays deselected).
// Nodes without such effects take the exact same synchronous path as
// before (see nodeNeedsChoices()).
//
// ------------------------------------------------------------
// PERSISTENCE (see treePersistence.js)
// ------------------------------------------------------------
// Every activation/deactivation in onClick() below also calls
// markNodeActive()/markNodeInactive() so a page reload knows which
// nodes to bring back. restoreActive() re-activates a node the same way
// onClick's activation branch does, but WITHOUT re-checking
// requirements/cost/mutual-exclusion, WITHOUT panning the camera, and
// WITHOUT opening the choice dialog (reuses the saved selection).
// ============================================================

import * as THREE from 'three';
import { Text } from 'troika-three-text';
import AppState from './appState.js';
import { BLOOM_LAYER, LABEL_FONT_URL, LABEL_MIN_SCALE } from './constants.js';
import { StarModel } from './StarModel.js';
import { computePanCamera } from './cameraControls.js';
import { handleEditModeNodeClick } from './editMode.js';
import {
    applyNodeEffect, removeNodeEffect, refreshPerksTaken, canRevokeNodeEffect,
    collectNodeChoices, nodeNeedsChoices,
} from './perkEffects.js';
import { computePotentialAvailable } from './characterState.js';
import { canPickPerks, canRevokePerk, getStage, STAGES } from './progressionState.js';
import { markNodeActive, markNodeInactive } from './treePersistence.js';

export class TreeNode extends THREE.Mesh {
    /**
     * @param {string|number} anodeId
     * @param {string}        anodeName
     * @param {string}        anodeDesc    — use "<D>" for line breaks
     * @param {string}        ahoverText
     * @param {number}        posX, posY, posZ  — world position on the skill sphere
     * @param {number}        afi               — fi (longitude) in radians
     * @param {number}        atheta            — theta (latitude) in radians
     * @param {(string|string[])[]} requires    — prerequisite entries; [] means none
     * @param {number}        anodeCost
     * @param {{label:string,max:number,members:string[]}|null} exclStuff — shared mutual-exclusion group, or null
     * @param {number}        temperature       — blackbody colour temp in Kelvin
     * @param {{type:string,key:string,amount:number}[]} [effects] — Character Data tab effects; [] or omitted = none
     */
    constructor(anodeId, anodeName, anodeDesc, ahoverText,
                posX, posY, posZ, afi, atheta,
                requires, anodeCost, exclStuff, temperature, effects) {
        super();

        this.temperature = temperature;
        this.isHovered   = false;
        this.skyLines    = []; // arc Line objects connected to this node
        this.reqTubes    = []; // [mesh1h, mesh2h] pairs for each requirement arc
        this._choosing   = false; // true while the choice dialog for this node is open

        // Visual size scales with cost
        this.nodeSize = anodeCost < 1
        ? 0.1
        : Math.pow(((anodeCost)), (1/2))/10;

        this.excl    = exclStuff || null;
        this.effects = Array.isArray(effects) ? effects : [];
        this.fi    = -afi;    // negated: positive fi in data → expected visual direction
        this.theta = atheta;

        // ---- Invisible hit sphere ------------------------------------
        this.geometry = new THREE.SphereGeometry(this.nodeSize, 16, 16);
        this.material = new THREE.MeshBasicMaterial({
            color: 0x999999, wireframe: true, opacity: 0.01, transparent: true, depthWrite: false,
        });
        this.position.set(posX, posY, posZ);

        // ---- 3D text label ---------------------------------------------
        // Rendered via troika-three-text (SDF text sampled from a real
        // font file — see constants.js's LABEL_FONT_URL). The font file can
        // be any real TTF/OTF, so it contains Polish diacritics.
        // anchorX: 'left' / anchorY: 'middle' — troika aligns the glyphs
        // relative to `.position`, i.e. "the point on the sphere surface
        // next to the node".
        this.nameText = new Text();
        this.nameText.text        = anodeName;
        this.nameText.font        = LABEL_FONT_URL;
        this.nameText.fontSize    = 0.01;      // baseline size — see LABEL_MIN_SCALE in constants.js
        this.nameText.color       = 0xfafafa;
        this.nameText.outlineWidth = '8%';
        this.nameText.outlineColor = 0xaa2bef;
        this.nameText.anchorX     = 'left';
        this.nameText.anchorY     = 'middle';
        this.nameText.sync();

        this.nameText.position.set(
            this.position.x + (this.nodeSize + 0.01) * Math.sin(this.fi),
                                   this.position.y,
                                   this.position.z + (this.nodeSize + 0.01) * Math.cos(this.fi)
        );
        // Face the label toward the origin (where the camera sits) at any latitude.
        const outward = this.position.clone().multiplyScalar(0.5);
        this.nameText.lookAt(outward);
        // Zoom-driven size (see updateLabelScale() below / main.js's animate())
        this.nameText.scale.setScalar(LABEL_MIN_SCALE);
        AppState.scene.add(this.nameText);

        // ---- StarModel (async texture load + lava shader) ------------
        this.starID = AppState.starClasses.length;
        AppState.starClasses.push(new StarModel(this.temperature));

        // ---- Core properties -----------------------------------------
        this.nodeName   = anodeName;
        this.nodeDesc   = anodeDesc;
        this.nodeCost   = anodeCost;
        this.nodeActive = false;
        this.hovertext  = ahoverText;
        this.nodeId     = anodeId;

        this.requires = requires || [];

        // ---- Visible star mesh (starts invisible) --------------------
        // Assigned to the bloom layer so it glows when the lava shader is active.
        this.star = new THREE.Mesh(
            new THREE.SphereGeometry(this.nodeSize / 4, 16, 16),
                                   new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0.0, transparent: true, depthWrite: false })
        );
        this.star.layers.set(BLOOM_LAYER);
        AppState.bloomEffect.selection.add(this.star);

        this.star.position.set(posX, posY, posZ);
        AppState.scene.add(this.star);
    }

    // ----------------------------------------------------------------
    // Hover
    // ----------------------------------------------------------------

    onPointerOver(e) {
        this.scale.set(2, 2, 2);
        this.star.scale.set(2, 2, 2);
        this.isHovered = true;

        this.nameText.position.set(
            this.position.x + (this.nodeSize + 0.01) * Math.sin(this.fi) * this.scale.x,
                                   this.position.y,
                                   this.position.z + (this.nodeSize + 0.01) * Math.cos(this.fi) * this.scale.z
        );

        document.getElementById('nodeName').textContent = this.nodeName;

        const nodeDescEl = document.getElementById('nodeDesc');
        nodeDescEl.textContent = '';
        const parts = this.nodeDesc.split('<D>');
        const br    = document.createElement('br');
        for (let i = 0; i < parts.length; i++) {
            nodeDescEl.innerText += parts[i];
            if (i < parts.length - 1) nodeDescEl.appendChild(br);
        }

        document.getElementById('nodeCost').textContent  = 'Koszt: ' + this.nodeCost + ' punktów potencjału.';
        document.getElementById('perkPoints').textContent = computePotentialAvailable();
    }

    onPointerOut(e) {
        this.scale.set(1, 1, 1);
        this.star.scale.set(1, 1, 1);
        this.isHovered = false;

        this.nameText.position.set(
            this.position.x + (this.nodeSize + 0.01) * Math.sin(this.fi),
                                   this.position.y,
                                   this.position.z + (this.nodeSize + 0.01) * Math.cos(this.fi)
        );
    }

    /**
     * Rescales just the nameText label (not the node's hit-sphere/star)
     * based on the current zoom level. Cheap — a plain Object3D.scale
     * write — so it's safe to call every frame for every node.
     * @param {number} scaleFactor
     */
    updateLabelScale(scaleFactor) {
        this.nameText.scale.setScalar(scaleFactor);
    }

    // ----------------------------------------------------------------
    // Click
    // ----------------------------------------------------------------

    async onClick(e) {
        // ---- Edit mode -------------------------------------------------
        // While the editor is on, clicking a node selects it for the
        // inspector instead of running perk activation.
        if (AppState.editMode) {
            handleEditModeNodeClick(this);
            return;
        }

        // The choice dialog for this node is already open.
        if (this._choosing) return;

        const tr = AppState.tr;

        // ---- isNextActive --------------------------------------------
        // Returns true if any currently-active node lists `id` as a
        // prerequisite, preventing premature deactivation.
        function isNextActive(id) {
            for (let i = 0; i < tr.nodes.length; i++) {
                for (let j = 0; j < tr.nodes[i].requires.length; j++) {
                    const req = tr.nodes[i].requires[j];
                    if (Array.isArray(req)) {
                        const group = req;
                        let inactiveCount = 0;
                        let isInGroup     = false;
                        for (const memberId of group) {
                            if (memberId == id && tr.nodes[i].nodeActive && !(id == 1 && tr.nodes[i].nodeId < 0)) {
                                isInGroup = true;
                            } else {
                                const member = tr.resolveNode(memberId);
                                if (!member || !member.nodeActive) inactiveCount++;
                            }
                        }
                        if (inactiveCount === group.length - 1 && isInGroup) return true;
                    } else {
                        if (req == id && tr.nodes[i].nodeActive && !(id == 1 && tr.nodes[i].nodeId < 0)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        // ---- isMutExclCritMet ----------------------------------------
        // Returns false if activating `passedIdNum` would exceed the
        // simultaneous-active limit for its mutual-exclusion group.
        function isMutExclCritMet(passedIdNum) {
            const selfNode = tr.resolveNode(passedIdNum);
            const group = selfNode ? selfNode.excl : null;
            if (!group || !Array.isArray(group.members)) return true;
            let count = 0;
            for (const memberId of group.members) {
                const member = tr.resolveNode(memberId);
                if (member && member.nodeActive) count++;
            }
            return count < group.max;
        }

        if (this.nodeActive && !isNextActive(this.nodeId)) {
            // Deactivate — gated first by the current progression stage
            // (progressionState.js), then by the currency/item refund check.
            if (!canRevokePerk(this.nodeId)) {
                window.alert(
                    getStage() === STAGES.USAGE
                    ? `Nie można cofnąć perku "${this.nodeName}" — wybór perków jest zablokowany podczas etapu Użytkowania.`
                    : `Nie można cofnąć perku "${this.nodeName}" — został on trwale zablokowany we wcześniejszym etapie.`
                );
            } else if (!canRevokeNodeEffect(this)) {
                window.alert(
                    `Nie można cofnąć perku "${this.nodeName}" — przyznana waluta lub przedmioty zostały już częściowo wydane/zużyte. Odzyskaj wystarczającą ilość, by móc go cofnąć.`
                );
            } else {
                this.nodeActive   = false;
                this.star.material = new THREE.MeshBasicMaterial({
                    color: 0x000000, opacity: 0.0, transparent: true, depthWrite: false,
                });
                removeNodeEffect(this);
                markNodeInactive(this.nodeId); // persist across reloads — see treePersistence.js
                refreshPerksTaken();
            }

        } else if (
            canPickPerks() &&
            computePotentialAvailable() >= this.nodeCost &&
            tr.areReqsMet(this.requires) &&
            isMutExclCritMet(this.nodeId) &&
            !this.nodeActive
        ) {
            // Perks with 'attributeChoice' / 'spellSchoolUnlock' effects first ask
            // the player to pick from a list. Giving up there means the perk is
            // never activated. Perks without such effects stay fully synchronous.
            let choices;
            if (nodeNeedsChoices(this)) {
                this._choosing = true;
                try {
                    choices = await collectNodeChoices(this);
                } finally {
                    this._choosing = false;
                }
                if (choices === null) return; // "Zrezygnuj z wybierania…" — perk stays deselected

                // The dialog was modal, but re-check in case something changed meanwhile.
                if (this.nodeActive || !canPickPerks() || computePotentialAvailable() < this.nodeCost) return;
            } else {
                choices = { attr: {}, spell: {} };
            }

            this.nodeActive    = true;
            this._applyActiveStarVisual();
            applyNodeEffect(this, { choices });
            markNodeActive(this.nodeId); // persist across reloads — see treePersistence.js
            refreshPerksTaken();
        }

        document.getElementById('perkPoints').textContent = computePotentialAvailable();

        // Pan the camera to face this node
        if (!AppState.panCamBool && !AppState.zoomCamBool) {
            AppState.panCamBool = true;
            computePanCamera(
                AppState.camera.rotation.x,
                AppState.camera.rotation.y,
                this.theta,
                this.fi - Math.PI / 2
            );
        }
    }

    /**
     * Re-activates this node WITHOUT checking requirements/cost/
     * mutual-exclusion, WITHOUT panning the camera, and WITHOUT opening
     * the choice dialog — used ONLY to restore a previously-active node
     * after a page reload (see treePersistence.js's restoreActiveNodes()).
     *
     * Does NOT call markNodeActive() itself — the node is already
     * recorded as active in treePersistence.js.
     *
     * @param {{[effectIndex:string]:number[]}|null} savedChoices — persisted attributeChoice selections
     * @param {{[effectIndex:string]:string|null}|null} savedSpellChoices — persisted spellSchoolUnlock spell choices
     */
    restoreActive(savedChoices, savedSpellChoices) {
        this.nodeActive   = true;
        this._applyActiveStarVisual();
        applyNodeEffect(this, { restoring: true, savedChoices, savedSpellChoices });
    }

    /**
     * Safely swaps this node's star mesh onto its StarModel's animated
     * lava material — but only once that material actually exists.
     * StarModel loads its textures asynchronously; assigning
     * `customMaterial` before it exists would set `this.star.material`
     * to `undefined` and crash the renderer on the next frame. If the
     * model isn't ready, the assignment is queued via StarModel.onReady()
     * and re-checks `this.nodeActive` once it fires.
     */
    _applyActiveStarVisual() {
        const starModel = AppState.starClasses[this.starID];
        if (starModel.isModelReady()) {
            this.star.material = starModel.customMaterial;
        } else {
            starModel.onReady(() => {
                if (this.nodeActive) this.star.material = starModel.customMaterial;
            });
        }
    }

    getFi()    { return this.fi;    }
    getTheta() { return this.theta; }

    // ----------------------------------------------------------------
    // reposition  (edit mode)
    // ----------------------------------------------------------------

    /**
     * Recomputes this node's world position from new fi/theta
     * (in DEGREES) and moves every visual piece — hit-sphere,
     * star, and label — to match. Does NOT redraw arcs itself — call
     * AppState.tr.rebuildArcs() afterward.
     *
     * @param {number} fiDeg
     * @param {number} thetaDeg
     */
    reposition(fiDeg, thetaDeg) {
        const R     = AppState.tr.sphereRadius;
        const fiRad = fiDeg    * Math.PI / 180;
        const thRad = thetaDeg * Math.PI / 180;

        const x = R * Math.cos(thRad) * Math.cos(fiRad);
        const y = R * Math.sin(thRad);
        const z = R * Math.cos(thRad) * Math.sin(fiRad);

        this.position.set(x, y, z);
        this.star.position.set(x, y, z);

        this.fi    = -fiRad; // negated, matching the constructor's convention
        this.theta = thRad;

        this.nameText.position.set(
            this.position.x + (this.nodeSize + 0.01) * Math.sin(this.fi),
                                   this.position.y,
                                   this.position.z + (this.nodeSize + 0.01) * Math.cos(this.fi)
        );
        const outward = this.position.clone().multiplyScalar(0.5);
        this.nameText.lookAt(outward);
    }

    // ----------------------------------------------------------------
    // toJSON  (edit mode export)
    // ----------------------------------------------------------------

    /**
     * Serializes this node back into the nodes.json node shape.
     * fi/theta are recovered (in degrees) from the same negated-radian
     * fields the constructor/reposition() set.
     */
    toJSON() {
        return {
            id:          this.nodeId,
            name:        this.nodeName,
            desc:        this.nodeDesc,
            hoverText:   this.hovertext,
            fi:          -this.fi * 180 / Math.PI,
            theta:        this.theta * 180 / Math.PI,
            requires:    this.requires,
            cost:        this.nodeCost,
            temperature: this.temperature,
            exclGroup:   this.excl ? this.excl.label : null,
            effects:     this.effects,
        };
    }
}
