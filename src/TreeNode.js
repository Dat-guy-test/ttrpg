// ============================================================
// TreeNode  (extends THREE.Mesh)
//
// Represents a single perk / skill in the skill tree.
// Each instance owns:
//   • An invisible sphere (the Mesh itself) — raycaster hit target
//   • A small star mesh      — visible glowing dot, added to bloom
//   • A 3D text label mesh   — node name, tangent to the sphere
//   • A StarModel            — shared lava-shader, applied on activation
//
// `requires`: array whose entries are a plain id string (AND) or an
// array of id strings (OR group) — see Tree.js.
// `excl`: null or a shared group object { label, max, members }.
// `effects`: array of effects applied to the sheets when active — see
// perkEffects.js / characterState.js.
//
// PLAYER CHOICES ON ACTIVATION: nodes with 'attributeChoice' /
// 'spellSchoolUnlock' effects open choiceDialog.js before activating;
// giving up there leaves the node deselected. onClick() is async for
// that reason.
//
// PERSISTENCE: every (de)activation calls markNodeActive()/
// markNodeInactive(); restoreActive() re-activates silently after a reload.
//
// PERFORMANCE NOTES (changes vs. the previous version)
//   - Sphere geometries are shared between nodes (keyed by radius) and
//     the hit-sphere / inactive-star materials are single shared
//     instances, instead of 2 geometries + 2 materials per node.
//   - An INACTIVE star used to be drawn as a fully transparent mesh
//     (opacity 0) every frame, in the main pass AND in the selective-
//     bloom pass — 150+ pointless draw calls each. It is now simply
//     `visible = false` until the node is activated. Pixel-identical.
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

// ---- Shared GPU resources ---------------------------------------------
const sphereGeometryCache = new Map();
function getSphereGeometry(radius) {
    let geo = sphereGeometryCache.get(radius);
    if (!geo) {
        geo = new THREE.SphereGeometry(radius, 16, 16);
        sphereGeometryCache.set(radius, geo);
    }
    return geo;
}

// The faint wireframe (1% opacity) is an intentional visual — keep it drawn.
// One shared material for all nodes (this is also what the raycaster hits).
const HIT_MATERIAL = new THREE.MeshBasicMaterial({
    color: 0x999999, wireframe: true, opacity: 0.01, transparent: true, depthWrite: false,
});

// Placeholder material for an inactive star (the mesh is invisible anyway).
const INACTIVE_STAR_MATERIAL = new THREE.MeshBasicMaterial({
    color: 0x000000, opacity: 0.0, transparent: true, depthWrite: false,
});


export class TreeNode extends THREE.Mesh {
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
        this.geometry = getSphereGeometry(this.nodeSize);
        this.material = HIT_MATERIAL;
        this.position.set(posX, posY, posZ);

        // ---- 3D text label ---------------------------------------------
        this.nameText = new Text();
        this.nameText.text        = anodeName;
        this.nameText.font        = LABEL_FONT_URL;
        this.nameText.fontSize    = 0.01;
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
        const outward = this.position.clone().multiplyScalar(0.5);
        this.nameText.lookAt(outward);
        this.nameText.scale.setScalar(LABEL_MIN_SCALE);
        AppState.scene.add(this.nameText);

        // ---- StarModel (shared textures/material) --------------------
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

        // ---- Visible star mesh (hidden until the node is activated) ----
        this.star = new THREE.Mesh(getSphereGeometry(this.nodeSize / 4), INACTIVE_STAR_MATERIAL);
        this.star.visible = false;
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

    /** Rescales just the nameText label based on the current zoom level. */
    updateLabelScale(scaleFactor) {
        this.nameText.scale.setScalar(scaleFactor);
    }

    // ----------------------------------------------------------------
    // Click
    // ----------------------------------------------------------------

    async onClick(e) {
        if (AppState.editMode) {
            handleEditModeNodeClick(this);
            return;
        }

        if (this._choosing) return;

        const tr = AppState.tr;

        // True if any currently-active node lists `id` as a prerequisite.
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

        // False if activating `passedIdNum` would exceed its mutual-exclusion group's limit.
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
            // Deactivate — gated by progression stage, then by the currency/item refund check.
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
                this.nodeActive = false;
                this._applyInactiveStarVisual();
                removeNodeEffect(this);
                markNodeInactive(this.nodeId);
                refreshPerksTaken();
            }

        } else if (
            canPickPerks() &&
            computePotentialAvailable() >= this.nodeCost &&
            tr.areReqsMet(this.requires) &&
            isMutExclCritMet(this.nodeId) &&
            !this.nodeActive
        ) {
            let choices;
            if (nodeNeedsChoices(this)) {
                this._choosing = true;
                try {
                    choices = await collectNodeChoices(this);
                } finally {
                    this._choosing = false;
                }
                if (choices === null) return; // gave up — perk stays deselected

                if (this.nodeActive || !canPickPerks() || computePotentialAvailable() < this.nodeCost) return;
            } else {
                choices = { attr: {}, spell: {} };
            }

            this.nodeActive    = true;
            this._applyActiveStarVisual();
            applyNodeEffect(this, { choices });
            markNodeActive(this.nodeId);
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
     * Re-activates this node WITHOUT checking requirements/cost/exclusion,
     * panning, or opening the choice dialog — used only to restore a node
     * after a page reload (see treePersistence.js).
     */
    restoreActive(savedChoices, savedSpellChoices) {
        this.nodeActive   = true;
        this._applyActiveStarVisual();
        applyNodeEffect(this, { restoring: true, savedChoices, savedSpellChoices });
    }

    /**
     * Shows the star with its shared lava material — but only once that
     * material can exist (StarModel loads asynchronously; assigning an
     * undefined material would crash the renderer). Otherwise deferred
     * via StarModel.onReady(), re-checking `nodeActive` when it fires.
     */
    _applyActiveStarVisual() {
        const starModel = AppState.starClasses[this.starID];
        if (starModel.isModelReady()) {
            this.star.material = starModel.customMaterial;
            this.star.visible  = true;
        } else {
            starModel.onReady(() => {
                if (this.nodeActive) {
                    this.star.material = starModel.customMaterial;
                    this.star.visible  = true;
                }
            });
        }
    }

    _applyInactiveStarVisual() {
        this.star.visible  = false;
        this.star.material = INACTIVE_STAR_MATERIAL;
    }

    getFi()    { return this.fi;    }
    getTheta() { return this.theta; }

    // ----------------------------------------------------------------
    // reposition  (edit mode)
    // ----------------------------------------------------------------

    /**
     * Recomputes world position from fi/theta (DEGREES) and moves the
     * hit-sphere, star and label. Call AppState.tr.rebuildArcs() afterwards.
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

        this.fi    = -fiRad;
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