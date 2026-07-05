// ============================================================
// Tree
//
// Exports:
//   Tree class    — holds nodes, draws arcs, provides lookups
//   treeGen(tree) — async: loads data (now local JSON), populates tree
//
// areReqsMet() is a method on Tree (not a standalone export).
// TreeNode calls it via AppState.tr.areReqsMet(…).
// This is the key design choice that prevents the
//   Tree → TreeNode → Tree
// circular import that would occur if areReqsMet were exported
// from this file and imported by TreeNode.
//
// ------------------------------------------------------------
// DATA FORMAT (as of the JSON migration)
// ------------------------------------------------------------
// Requirements are now real arrays instead of delimiter-encoded
// strings:
//   "5"                          — AND: node 5 must be active
//   ["-1001", "-1002", "-1003"]  — OR: at least one member must be active
// A node's `requires` field is an array whose entries are each
// either a plain id string (AND) or an array of id strings (OR
// group). This replaces the old "-1001o-1002o-1003" string format,
// which broke down as soon as an id or delimiter collided.
//
// Mutual-exclusion groups are shared objects: { label, max, members }.
// Every member TreeNode's `.excl` points at the SAME object, so all
// members of a group are always looking at one shared max/members —
// convenient once edit-mode code starts mutating groups live.
//
// A node's `effects` (optional) is an array of { type, key, amount }
// entries describing its contribution(s) to the Character Data tab —
// see characterState.js's EFFECT_TYPES and perkEffects.js. A node can
// carry any number of effects. addNodeEffect()/removeNodeEffectAt()
// below are the two places that mutate the list, so an active node's
// contribution always stays in sync with its current effects.
//
// Backward compatibility: nodes.json exported before this array-based
// format used a single `effect: {...}` object. normalizeEffects()
// below reads that transparently and wraps it into a one-item array,
// so older exported files keep working without editing.
// ============================================================

import * as THREE from 'three';
import AppState from './appState.js';
import { TreeNode } from './TreeNode.js';
import { computePanCamera } from './cameraControls.js';
import { NODE_DATA_URL } from './constants.js';
import { handleTreesphereClick, handleEditModeConnectionClick } from './editMode.js';
import { applyNodeEffect, removeNodeEffect, refreshPerksTaken } from './perkEffects.js';


/**
 * Reads a node's effects off either the current array format
 * (`effects: [...]`) or the older single-object format
 * (`effect: {...}`), always returning an array. Used by both
 * treeGen() (loading nodes.json) and addNode() (edit-mode creation).
 * @param {object} source — a nodeData object or an addNode() data object
 * @returns {{type:string,key:string,amount:number}[]}
 */
function normalizeEffects(source) {
    if (Array.isArray(source.effects)) return source.effects;
    if (source.effect) return [source.effect];
    return [];
}

export class Tree {
    /**
     * @param {number} smolFi  — min fi  (longitude) in degrees
     * @param {number} highFi  — max fi  (longitude) in degrees
     * @param {number} smolTh  — min theta (latitude) in degrees
     * @param {number} highTh  — max theta (latitude) in degrees
     */
    constructor(smolFi, highFi, smolTh, highTh) {
        this.nodes         = [];   // TreeNode[]
        this.mutExclGroups = [];   // [{ label, max, members }, …] — filled in by treeGen()
        this.nodeIDs       = [];   // sparse map: nodeId → index in this.nodes
        this.span          = [smolFi, highFi, smolTh, highTh];

        this.sphereRadius = 30;

        // Semi-transparent debug sphere showing the tree's extent.
        // In edit mode's "addNode" submode, clicking it places a new node
        // at the clicked fi/theta — see handleTreesphereClick() in editMode.js.
        //
        // IMPORTANT: side must be DoubleSide. AppState.camera sits at the
        // origin — the exact center of this sphere — so every ray fired
        // outward from it hits the sphere's BACK face (normals point
        // outward, same direction as the ray, which is the definition of
        // a back face). With the default FrontSide material, THREE.js's
        // raycaster silently back-face-culls that hit and Add Node never
        // fires at all, even though the sphere still renders fine (same
        // reason sceneSetup.js's skybox — also camera-enclosing — uses
        // BackSide instead of the default).
        this.treesphere = new THREE.Mesh(
            new THREE.SphereGeometry(this.sphereRadius, 32, 16),
                                         new THREE.MeshBasicMaterial({ color: 'black', transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        this.treesphere.onClick = (hit) => handleTreesphereClick(hit);
        AppState.scene.add(this.treesphere);
    }

    // ----------------------------------------------------------------
    // resolveNode  (defensive lookup)
    // ----------------------------------------------------------------

    /**
     * Safely resolves a node by id. Returns undefined — and logs a
     * one-time console error naming the bad id — if no node matches,
     * instead of letting callers crash on `undefined.star` /
     * `undefined.nodeActive`. This is what keeps a single typo in a
     * hand-edited requires/exclGroup entry from taking down arc
     * drawing, camera setup, and every other node's activation with it.
     *
     * @param {string|number} id
     * @returns {TreeNode|undefined}
     */
    resolveNode(id) {
        const node = this.nodes[this.nodeIDs[id]];
        if (!node) {
            if (!this._warnedMissingIds) this._warnedMissingIds = new Set();
            if (!this._warnedMissingIds.has(id)) {
                this._warnedMissingIds.add(id);
                console.error(`Tree: no node found with id "${id}" — check nodes.json for a typo or a dangling reference.`);
            }
            return undefined;
        }
        return node;
    }

    // ----------------------------------------------------------------
    // areReqsMet  (instance method — avoids a circular import)
    // ----------------------------------------------------------------

    /**
     * Returns true if every requirement in `reqs` is satisfied.
     *
     * Formats:
     *   "nodeId"        — AND: that node must be active
     *   ["idA","idB"]   — OR: at least one of idA, idB must be active
     *
     * An id that doesn't resolve to a real node (bad data) is treated
     * as inactive/unsatisfied rather than throwing.
     *
     * @param {(string|string[])[]} reqs
     * @returns {boolean}
     */
    areReqsMet(reqs) {
        for (const req of reqs) {
            if (Array.isArray(req)) {
                // OR group — ALL inactive (or unresolved) → fail
                const allInactive = req.every(id => {
                    const node = this.resolveNode(id);
                    return !node || !node.nodeActive;
                });
                if (allInactive) return false;
            } else {
                const node = this.resolveNode(req);
                if (!node || !node.nodeActive) return false;
            }
        }
        return true;
    }

    // ----------------------------------------------------------------
    // createLinesNTubes
    // ----------------------------------------------------------------

    /**
     * Draws a great-circle arc between two sphere-surface points and
     * places two invisible tube halves along it as click targets.
     *
     * @param {THREE.Vector3} pointStart
     * @param {THREE.Vector3} pointEnd
     * @param {number}  smoothness  — arc sample count
     * @param {boolean} clockWise   — take the long way round
     * @param {boolean} dashed      — OR-req (dashed) vs AND-req (solid)
     * @param {number}  a           — index of destination node
     * @param {number}  b           — index of the requirement entry
     * @param {number}  kej         — OR-group member index (-1 = AND link)
     * @param {string[]} ej         — OR-group member array
     */
    createLinesNTubes(pointStart, pointEnd, smoothness, clockWise, dashed, a, b, kej, ej) {
        // Great-circle rotation axis = cross(origin−end, start−end) normalised
        const cb = new THREE.Vector3(), ab = new THREE.Vector3(), normal = new THREE.Vector3();
        cb.subVectors(new THREE.Vector3(), pointEnd);
        ab.subVectors(pointStart, pointEnd);
        cb.cross(ab);
        normal.copy(cb).normalize();

        let angle = pointStart.angleTo(pointEnd);
        if (clockWise) angle -= Math.PI * 2;
        const angleDelta = angle / (smoothness - 1);

        const pnts = [];
        for (let i = 0; i < smoothness; i++) {
            pnts.push(pointStart.clone().applyAxisAngle(normal, angleDelta * i));
        }

        // Visible arc line
        const path         = new THREE.CatmullRomCurve3(pnts);
        const pathGeometry = new THREE.BufferGeometry().setFromPoints(path.getPoints(50));

        if (dashed) {
            const arc = new THREE.Line(
                pathGeometry,
                new THREE.LineDashedMaterial({ color: 0x666666, dashSize: 0.01, gapSize: 0.01 })
            );
            arc.computeLineDistances();
            AppState.scene.add(arc);
            this.nodes[a].skyLines.push(arc);
        } else {
            const arc = new THREE.Line(
                pathGeometry,
                new THREE.LineBasicMaterial({ color: 0x666666 })
            );
            AppState.scene.add(arc);
            this.nodes[a].skyLines.push(arc);
        }

        // Split arc into two invisible click-target tubes
        const pnts1h = [], pnts2h = [];
        const mid = Math.floor(pnts.length / 2);
        for (let i = 0; i <= mid + 1 && i < pnts.length; i++) pnts1h.push(pnts[i]);
        for (let i = mid + 1; i < pnts.length; i++)            pnts2h.push(pnts[i]);

        const mesh1h = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pnts1h), 20, 0.02, 8, false),
                                      new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, opacity: 0.0, transparent: true, depthWrite: false })
        );
        const mesh2h = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pnts2h), 20, 0.01, 8, false),
                                      new THREE.MeshBasicMaterial({ color: 0x0000ff, wireframe: true, opacity: 0.0, transparent: true, depthWrite: false })
        );

        // Click handlers close over the loop variables a, b, kej, ej.
        // All global state accessed via AppState; computePanCamera imported above.
        const self = this; // capture tree instance for the closures below

        if (kej === -1) {
            // AND link
            mesh1h.onClick = function () {
                if (AppState.editMode) { handleEditModeConnectionClick(self, a, b); return; }
                const reqNode = self.nodes[self.nodeIDs[self.nodes[a].requires[b]]];
                if (!reqNode.isHovered && !AppState.panCamBool && !AppState.zoomCamBool) {
                    AppState.panCamBool = true;
                    computePanCamera(
                        AppState.camera.rotation.x, AppState.camera.rotation.y,
                        self.nodes[a].theta, self.nodes[a].fi - Math.PI / 2
                    );
                }
            };
            mesh2h.onClick = function () {
                if (AppState.editMode) { handleEditModeConnectionClick(self, a, b); return; }
                const reqNode = self.nodes[self.nodeIDs[self.nodes[a].requires[b]]];
                if (!self.nodes[a].isHovered && !AppState.panCamBool && !AppState.zoomCamBool) {
                    AppState.panCamBool = true;
                    computePanCamera(
                        AppState.camera.rotation.x, AppState.camera.rotation.y,
                        reqNode.theta, reqNode.fi - Math.PI / 2
                    );
                }
            };
        } else {
            // OR link
            mesh1h.onClick = function () {
                if (AppState.editMode) { handleEditModeConnectionClick(self, a, b); return; }
                const reqNode = self.nodes[self.nodeIDs[ej[kej]]];
                if (!reqNode.isHovered && !AppState.panCamBool && !AppState.zoomCamBool) {
                    AppState.panCamBool = true;
                    computePanCamera(
                        AppState.camera.rotation.x, AppState.camera.rotation.y,
                        self.nodes[a].theta, self.nodes[a].fi - Math.PI / 2
                    );
                }
            };
            mesh2h.onClick = function () {
                if (AppState.editMode) { handleEditModeConnectionClick(self, a, b); return; }
                const reqNode = self.nodes[self.nodeIDs[ej[kej]]];
                if (!self.nodes[a].isHovered && !AppState.panCamBool && !AppState.zoomCamBool) {
                    AppState.panCamBool = true;
                    computePanCamera(
                        AppState.camera.rotation.x, AppState.camera.rotation.y,
                        reqNode.theta, reqNode.fi - Math.PI / 2
                    );
                }
            };
        }

        AppState.scene.add(mesh1h);
        AppState.scene.add(mesh2h);
        this.nodes[a].reqTubes.push([mesh1h, mesh2h]);
    }

    // ----------------------------------------------------------------
    // init  — call once after all nodes are loaded
    // ----------------------------------------------------------------

    /**
     * 1) Builds the nodeIDs sparse map (nodeId → array index).
     * 2) Draws every requirement arc via rebuildArcs().
     */
    init() {
        for (let i = 0; i < this.nodes.length; i++) {
            this.nodeIDs[this.nodes[i].nodeId] = i;
        }
        this.rebuildArcs();
    }

    /**
     * Removes every currently-drawn arc/tube-pair from the scene and
     * clears each node's skyLines/reqTubes bookkeeping. Always call
     * this before redrawing, or arcs pile up as duplicates.
     */
    clearArcs() {
        for (const node of this.nodes) {
            for (const line of node.skyLines) AppState.scene.remove(line);
            for (const pair of node.reqTubes) {
                AppState.scene.remove(pair[0]);
                AppState.scene.remove(pair[1]);
            }
            node.skyLines = [];
            node.reqTubes = [];
        }
    }

    /**
     * (Re)draws every requirement arc from scratch, using each node's
     * CURRENT world position. Safe to call any time node positions or
     * requirements change — e.g. edit-mode's save flow calls this
     * after TreeNode.reposition() so arcs follow a moved node instead
     * of staying pinned to its old spot. Always clears first.
     *
     * A requirement id that doesn't resolve to a real node (typo,
     * dangling reference) is logged via resolveNode() and that ONE
     * arc is skipped — the rest of the tree still draws normally.
     */
    rebuildArcs() {
        this.clearArcs();

        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = 0; j < this.nodes[i].requires.length; j++) {
                const req  = this.nodes[i].requires[j];
                const endD = new THREE.Vector3();
                this.nodes[i].star.getWorldPosition(endD);

                if (Array.isArray(req)) {
                    // OR group — one dashed arc per member
                    const group = req;
                    for (let k = 0; k < group.length; k++) {
                        const startNode = this.resolveNode(group[k]);
                        if (!startNode) continue; // bad id in this OR group — skip just this arc

                        const startT = new THREE.Vector3();
                        const endD2  = new THREE.Vector3();
                        this.nodes[i].star.getWorldPosition(endD2);
                        startNode.star.getWorldPosition(startT);
                        this.createLinesNTubes(startT, endD2, 50, false, true, i, j, k, group);
                    }
                } else {
                    // AND — single solid arc
                    const startNode = this.resolveNode(req);
                    if (!startNode) continue; // bad id — skip just this arc

                    const startT = new THREE.Vector3();
                    startNode.star.getWorldPosition(startT);
                    this.createLinesNTubes(startT, endD, 50, false, false, i, j, -1, null);
                }
            }
        }
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    /**
     * @param {string|number} ID
     * @returns {THREE.Vector2}  x = fi, y = theta
     */
    getNodeSphericalCoordinates(ID) {
        const node = this.resolveNode(ID);
        if (!node) return new THREE.Vector2(0, 0);
        return new THREE.Vector2(node.getFi(), node.getTheta());
    }

    /**
     * @param {string|number} ID
     * @returns {THREE.Vector3}
     */
    getNodeWorldPosition(ID) {
        const v = new THREE.Vector3();
        const node = this.resolveNode(ID);
        if (node) node.getWorldPosition(v);
        return v;
    }

    /**
     * Serializes the whole tree back into the nodes.json shape — the
     * same shape treeGen() reads. Used by edit-mode's Export button.
     * Mutual-exclusion groups are deduplicated (each is a single
     * shared object referenced by every member node's `.excl`).
     *
     * @returns {{nodes: object[], mutuallyExclusive: object[]}}
     */
    toJSON() {
        const groups = new Set();
        for (const n of this.nodes) if (n.excl) groups.add(n.excl);

        return {
            nodes: this.nodes.map(n => n.toJSON()),
            mutuallyExclusive: Array.from(groups).map(g => ({
                label:   g.label,
                max:     g.max,
                members: [...g.members],
            })),
        };
    }

    // ----------------------------------------------------------------
    // Editor mutations (add node / add / remove requirement / effect)
    // ----------------------------------------------------------------

    /**
     * Converts a world-space point ON the sphere (e.g. a raycaster hit
     * against this.treesphere) back into fi/theta degrees — the exact
     * inverse of the x/y/z math in treeGen()/TreeNode.reposition().
     * Used by handleTreesphereClick() in editMode.js to place a new
     * node where the user clicked.
     *
     * @param {THREE.Vector3} point
     * @returns {{fiDeg: number, thetaDeg: number}}
     */
    worldPointToFiTheta(point) {
        const r = this.sphereRadius;
        const thetaRad = Math.asin(Math.max(-1, Math.min(1, point.y / r)));
        const fiRad    = Math.atan2(point.z, point.x);
        return {
            fiDeg:    fiRad * 180 / Math.PI,
            thetaDeg: thetaRad * 180 / Math.PI,
        };
    }

    /**
     * Creates and inserts a new TreeNode from edit-mode's "Add Node"
     * form. New nodes start with no requirements — link them up
     * afterward via addRequirement() / connect submode.
     *
     * @param {object} data - {id?, name, desc, hoverText, cost, temperature, fi, theta, exclGroup?, effects?}
     *   id is auto-generated (AppState.nextCustomNodeId) if omitted.
     *   fi/theta are in DEGREES.
     * @returns {TreeNode|null} the new node, or null if `id` was already taken
     */
    addNode(data) {
        const id = (data.id !== undefined && data.id !== null && data.id !== '')
        ? String(data.id)
        : String(AppState.nextCustomNodeId++);

        if (this.nodeIDs[id] !== undefined) {
            console.error(`Tree.addNode: id "${id}" is already in use — pick a different id.`);
            return null;
        }

        const fiRad = data.fi    * Math.PI / 180;
        const thRad = data.theta * Math.PI / 180;
        const x = this.sphereRadius * Math.cos(thRad) * Math.cos(fiRad);
        const y = this.sphereRadius * Math.sin(thRad);
        const z = this.sphereRadius * Math.cos(thRad) * Math.sin(fiRad);

        let exclGroup = null;
        if (data.exclGroup) {
            exclGroup = this.mutExclGroups.find(g => g.label === data.exclGroup) || null;
            if (!exclGroup) console.error(`Tree.addNode: exclGroup "${data.exclGroup}" not found — leaving node unassigned.`);
        }

        const node = new TreeNode(
            id, data.name || 'New Node', data.desc || '', data.hoverText || '',
            x, y, z, fiRad, thRad,
            [], data.cost || 0, exclGroup, data.temperature || 6000,
            normalizeEffects(data)
        );

        this.nodeIDs[id] = this.nodes.length;
        this.nodes.push(node);
        AppState.scene.add(node);

        if (exclGroup && !exclGroup.members.includes(id)) exclGroup.members.push(id);

        return node;
    }

    /**
     * Appends a requirement entry to a node's `requires` and redraws
     * arcs so the new connection is visible immediately.
     *
     * @param {string} nodeId
     * @param {string|string[]} reqEntry  — a single id (AND) or an
     *   array of ids (OR group)
     * @returns {boolean} whether it was added
     */
    addRequirement(nodeId, reqEntry) {
        const node = this.resolveNode(nodeId);
        if (!node) return false;
        node.requires.push(reqEntry);
        this.rebuildArcs();
        return true;
    }

    /**
     * Removes one requirement entry (by index into `requires`) from a
     * node and redraws arcs. Used both by the inspector's per-entry
     * "✕" buttons and by clicking an arc directly in edit mode.
     *
     * @param {string} nodeId
     * @param {number} reqIndex
     * @returns {boolean} whether it was removed
     */
    removeRequirement(nodeId, reqIndex) {
        const node = this.resolveNode(nodeId);
        if (!node || node.requires[reqIndex] === undefined) return false;
        node.requires.splice(reqIndex, 1);
        this.rebuildArcs();
        return true;
    }

    /**
     * Appends one effect to a node's `effects` list — e.g. a second
     * characteristic bump on top of one it already grants. Mirrors
     * addRequirement()'s live-edit pattern: applied immediately, no
     * separate "Save" step. If the node is currently active, its
     * existing contribution is removed first and the whole (now
     * longer) effects list is reapplied, so nothing double-counts.
     *
     * @param {string} nodeId
     * @param {{type:string, key:string, amount:number}} effect
     * @returns {boolean}
     */
    addNodeEffect(nodeId, effect) {
        const node = this.resolveNode(nodeId);
        if (!node) return false;

        if (node.nodeActive) removeNodeEffect(node);
        node.effects = [...node.effects, effect];
        if (node.nodeActive) applyNodeEffect(node);

        return true;
    }

    /**
     * Removes one effect (by index into `effects`) from a node. Same
     * live-edit pattern as removeRequirement().
     *
     * @param {string} nodeId
     * @param {number} effectIndex
     * @returns {boolean}
     */
    removeNodeEffectAt(nodeId, effectIndex) {
        const node = this.resolveNode(nodeId);
        if (!node || node.effects[effectIndex] === undefined) return false;

        if (node.nodeActive) removeNodeEffect(node);
        node.effects = node.effects.filter((_, i) => i !== effectIndex);
        if (node.nodeActive) applyNodeEffect(node);

        return true;
    }

    /**
     * Deletes a node entirely: removes its meshes (hit-sphere, star,
     * label, and any arcs touching it) from the scene, scrubs every
     * OTHER node's `requires` of any reference to it (a dangling
     * reference would otherwise crash the next areReqsMet() call),
     * removes it from its mutual-exclusion group's members if any,
     * removes its character-sheet contribution if it was active,
     * rebuilds nodeIDs (indices shift after the splice), and redraws
     * arcs.
     *
     * Note: this node's StarModel entry in AppState.starClasses is
     * left in place rather than reindexed — every other node's
     * `starID` is an index into that array, so removing an entry
     * would silently point them at the wrong shader. The orphaned
     * entry just sits idle; harmless, if a little wasteful.
     *
     * @param {string} id
     * @returns {boolean} whether a node was actually removed
     */
    removeNode(id) {
        const idx  = this.nodeIDs[id];
        const node = this.nodes[idx];
        if (!node) return false;

        if (node.nodeActive) {
            removeNodeEffect(node);
            refreshPerksTaken();
        }
        AppState.scene.remove(node.star);
        AppState.scene.remove(node.nameText);
        for (const line of node.skyLines) AppState.scene.remove(line);
        for (const pair of node.reqTubes) {
            AppState.scene.remove(pair[0]);
            AppState.scene.remove(pair[1]);
        }

        for (const n of this.nodes) {
            if (n === node) continue;
            n.requires = n.requires
            .map(req => Array.isArray(req) ? req.filter(m => m !== id) : req)
            .filter(req => Array.isArray(req) ? req.length > 0 : req !== id);
        }

        if (node.excl && Array.isArray(node.excl.members)) {
            node.excl.members = node.excl.members.filter(m => m !== id);
            if (node.excl.members.length === 0) {
                this.mutExclGroups = this.mutExclGroups.filter(g => g !== node.excl);
            }
        }

        this.nodes.splice(idx, 1);
        this.nodeIDs = [];
        for (let i = 0; i < this.nodes.length; i++) this.nodeIDs[this.nodes[i].nodeId] = i;

        this.rebuildArcs();
        return true;
    }

    /**
     * Assigns, reassigns, or clears a node's mutual-exclusion group,
     * and sets that group's `max`. Since a group is a single object
     * shared by every member's `.excl`, updating `max` here instantly
     * applies to every other member too — there's no per-node max,
     * only a per-group one.
     *
     * - Always detaches the node from whatever group it was in first.
     *   If that leaves the old group with zero members, the group is
     *   dropped from mutExclGroups entirely (no orphaned groups).
     * - `groupLabel` falsy (null/'') just clears the node's group.
     * - Otherwise finds a group with that label, or creates one (with
     *   the given `max`, minimum 1) if none exists yet.
     *
     * @param {string} nodeId
     * @param {string|null} groupLabel
     * @param {number} [max]  — used/updated when groupLabel is truthy
     * @returns {boolean}
     */
    setNodeExclGroup(nodeId, groupLabel, max) {
        const node = this.resolveNode(nodeId);
        if (!node) return false;

        const oldGroup = node.excl;
        if (oldGroup && Array.isArray(oldGroup.members)) {
            oldGroup.members = oldGroup.members.filter(m => m !== nodeId);
            if (oldGroup.members.length === 0) {
                this.mutExclGroups = this.mutExclGroups.filter(g => g !== oldGroup);
            }
        }

        if (!groupLabel) {
            node.excl = null;
            return true;
        }

        let group = this.mutExclGroups.find(g => g.label === groupLabel);
        if (!group) {
            group = { label: groupLabel, max: Math.max(1, max || 1), members: [] };
            this.mutExclGroups.push(group);
        } else if (max) {
            group.max = Math.max(1, max);
        }

        if (!group.members.includes(nodeId)) group.members.push(nodeId);
        node.excl = group;
        return true;
    }
     }


     // ============================================================
     // treeGen
     // Loads node data + mutually-exclusive group definitions from a
     // local JSON file (see constants.js → NODE_DATA_URL), then fills
     // `tree` with TreeNode instances.
     //
     // fi / theta in the JSON are already in degrees within the
     // tree's angular span — no more cross-dataset grid normalisation
     // (the old code rescaled every node's position based on the
     // min/max grid coordinate across the WHOLE dataset, which meant
     // adding a single outlier node could silently reflow every other
     // node's position — not something you want while hand-editing).
     // ============================================================

     export async function treeGen(tree) {

         const res  = await fetch(NODE_DATA_URL);
         const data = await res.json();

         // ---- Mutually-exclusive groups ---------------------------
         // Shared objects: every member TreeNode's `.excl` points at
         // the SAME object, so there's exactly one source of truth
         // per group (matters once edit-mode can add/remove members).
         // `members` is validated here — a malformed/missing members
         // array becomes [] with a console error instead of crashing
         // the first time something tries to iterate it.
         tree.mutExclGroups = (data.mutuallyExclusive || []).map(g => {
             if (!Array.isArray(g.members)) {
                 console.error(`Tree: mutual-exclusion group "${g.label}" has no valid "members" array — treating it as empty. Check nodes.json.`);
             }
             return {
                 label:   g.label,
                 max:     g.max,
                 members: Array.isArray(g.members) ? [...g.members] : [],
             };
         });

         // ---- Nodes -------------------------------------------------
         for (const nodeData of data.nodes) {
             const fiRad = nodeData.fi    * (Math.PI / 180);
             const thRad = nodeData.theta * (Math.PI / 180);

             const x = tree.sphereRadius * Math.cos(thRad) * Math.cos(fiRad);
             const y = tree.sphereRadius * Math.sin(thRad);
             const z = tree.sphereRadius * Math.cos(thRad) * Math.sin(fiRad);

             let exclGroup = null;
             if (nodeData.exclGroup) {
                 exclGroup = tree.mutExclGroups.find(g => g.label === nodeData.exclGroup) || null;
                 if (!exclGroup) {
                     console.error(`Tree: node "${nodeData.id}" references exclGroup "${nodeData.exclGroup}", but no mutuallyExclusive entry has that label. Check nodes.json.`);
                 }
             }

             const node = new TreeNode(
                 String(nodeData.id), nodeData.name, nodeData.desc, nodeData.hoverText,
                                       x, y, z, fiRad, thRad,
                                       nodeData.requires || [], nodeData.cost, exclGroup, nodeData.temperature,
                                       normalizeEffects(nodeData)
             );

             tree.nodes.push(node);
             AppState.scene.add(node);
         }

         AppState.cameraRotationOffsetFromTree = -Math.PI / 2;
     }

