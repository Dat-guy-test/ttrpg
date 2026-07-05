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
// the Character Data tab when active. A node can carry any number of
// effects (e.g. one node granting +1 Forma AND +1 Siła Woli). See
// perkEffects.js and characterState.js's EFFECT_TYPES for the
// available types. applyNodeEffect()/removeNodeEffect() are called
// from onClick() below, on activation/deactivation respectively.
// ============================================================

import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import AppState from './appState.js';
import { BLOOM_LAYER } from './constants.js';
import { StarModel } from './StarModel.js';
import { computePanCamera } from './cameraControls.js';
import { handleEditModeNodeClick } from './editMode.js';
import { applyNodeEffect, removeNodeEffect, refreshPerksTaken } from './perkEffects.js';
import { computePotentialAvailable } from './characterState.js';

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

        // Visual size scales with cost
        this.nodeSize = anodeCost < 1
        ? 0.05
        : 0.05 * ((anodeCost) ^ (1 / 3)); // ^ is bitwise XOR — original behaviour preserved

        this.excl    = exclStuff || null;
        this.effects = Array.isArray(effects) ? effects : [];
        this.fi    = -afi;    // negated: positive fi in data → expected visual direction
        this.theta = atheta;

        // ---- Invisible hit sphere ------------------------------------
        this.geometry = new THREE.SphereGeometry(this.nodeSize, 16, 16);
        this.material = new THREE.MeshBasicMaterial({
            color: 0x999999, wireframe: true, opacity: 0.002, transparent: true, depthWrite: false,
        });
        this.position.set(posX, posY, posZ);

        // ---- 3D text label -------------------------------------------
        this.nameTextGeometry = new TextGeometry(anodeName, {
            font:            AppState.hellishFont,
            size:            0.02,
            depth:           0.0,
            curveSegments:   12,
            bevelEnabled:    false,
            bevelThickness:  0.03,
            bevelSize:       0.02,
            bevelOffset:     0,
            bevelSegments:   5,
        });
        this.nameTextMaterials = [
            new THREE.MeshBasicMaterial({ color: 0xfafafa }), // front face
            new THREE.MeshBasicMaterial({ color: 0x00aaaa }), // side/depth face
        ];
        this.nameText = new THREE.Mesh(this.nameTextGeometry, this.nameTextMaterials);

        this.nameTextGeometry.computeBoundingBox();
        this.centerOffset = 0.5 * (
            this.nameTextGeometry.boundingBox.max.y -
            this.nameTextGeometry.boundingBox.min.y
        );

        this.nameText.position.set(
            this.position.x + (this.nodeSize + 0.01) * Math.sin(this.fi),
                                   this.position.y - this.centerOffset,
                                   this.position.z + (this.nodeSize + 0.01) * Math.cos(this.fi)
        );
        // Face the label toward the origin (where the camera sits) at any latitude.
        // lookAt() points local -Z at the target, so we aim at a point further
        // out along the same radial line — that puts local +Z (the readable
        // front face) back toward the origin, matching the original intent.
        const outward = this.position.clone().multiplyScalar(0.5);
        this.nameText.lookAt(outward);
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
        // addToBloom() is inlined here (avoids a circular import with sceneSetup.js):
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
                                               this.position.y - this.centerOffset,
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

                    document.getElementById('nodeCost').textContent  = 'Cost: ' + this.nodeCost;
                    document.getElementById('perkPoints').textContent = computePotentialAvailable();
                }

                onPointerOut(e) {
                    this.scale.set(1, 1, 1);
                    this.star.scale.set(1, 1, 1);
                    this.isHovered = false;

                    this.nameText.position.set(
                        this.position.x + (this.nodeSize + 0.01) * Math.sin(this.fi),
                                               this.position.y - this.centerOffset,
                                               this.position.z + (this.nodeSize + 0.01) * Math.cos(this.fi)
                    );
                }

                // ----------------------------------------------------------------
                // Click
                // ----------------------------------------------------------------

                onClick(e) {
                    // ---- Edit mode -------------------------------------------------
                    // While the editor is on, clicking a node selects it for the
                    // read-only inspector instead of running perk activation. This
                    // is the only edit-mode branch point right now — writing to
                    // fields, adding nodes, and connecting nodes are later steps.
                    if (AppState.editMode) {
                        handleEditModeNodeClick(this);
                        return;
                    }

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
                        // Deactivate — restore invisible material, remove this
                        // node's contribution to the character sheet, and drop
                        // it from the "Wybrane Perki" list. (Refunding its cost
                        // happens implicitly: refreshPerksTaken() below rebuilds
                        // CharacterState.perksTaken without this node, which is
                        // what computePotentialAvailable() sums against.)
                        this.nodeActive   = false;
                        this.star.material = new THREE.MeshBasicMaterial({
                            color: 0x000000, opacity: 0.0, transparent: true, depthWrite: false,
                        });
                        removeNodeEffect(this);
                        refreshPerksTaken();

                    } else if (
                        computePotentialAvailable() >= this.nodeCost &&
                        tr.areReqsMet(this.requires) &&          // ← method on Tree (avoids circular import)
                        isMutExclCritMet(this.nodeId) &&
                        !this.nodeActive
                    ) {
                        // Activate — spend cost (implicitly, via refreshPerksTaken()
                        // below adding this node into CharacterState.perksTaken),
                        // apply the lava-shader material, apply this node's effect
                        // (if any) to the character sheet, and add it to the
                        // "Wybrane Perki" list.
                        this.nodeActive    = true;
                        this.star.material  = AppState.starClasses[this.starID].customMaterial;
                        applyNodeEffect(this);
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

                getFi()    { return this.fi;    }
                getTheta() { return this.theta; }

                // ----------------------------------------------------------------
                // reposition  (edit mode)
                // ----------------------------------------------------------------

                /**
                 * Recomputes this node's world position from new fi/theta
                 * (in DEGREES) and moves every visual piece — hit-sphere,
                 * star, and label — to match. Mirrors the placement math
                 * used by the constructor and by Tree.js's treeGen().
                 *
                 * Does NOT redraw arcs itself — call AppState.tr.rebuildArcs()
                 * afterward (edit-mode's save flow does this), since arc
                 * geometry is baked in at draw time and won't follow a
                 * node that moves later.
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
                                               this.position.y - this.centerOffset,
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
                 * fi/theta are recovered (in degrees) from the same
                 * negated-radian fields the constructor/reposition() set,
                 * so export round-trips exactly with what treeGen() reads.
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
