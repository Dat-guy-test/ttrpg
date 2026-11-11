// ============================================================
// Tree
//
// Exports:
//   Tree class    — holds nodes, draws arcs, provides lookups
//   treeGen(tree) — async: loads data (local JSON), populates tree
//
// areReqsMet() is a method on Tree (not a standalone export) so
// TreeNode can call it via AppState.tr.areReqsMet(…) without a
// Tree → TreeNode → Tree circular import.
//
// DATA FORMAT
// A node's `requires` is an array whose entries are each a plain id
// string (AND), an array of id strings (OR group), or a
// { type:'characteristic', stat, min } gate.
// Mutual-exclusion groups are shared objects { label, max, members }.
// A node's `effects` is an array (old single `effect` objects are
// wrapped by normalizeEffects()).
//
// PERFORMANCE NOTES (changes vs. the previous version)
//   - The two invisible click-target tubes per arc (hundreds of
//     meshes) used to be drawn every frame as fully transparent
//     meshes. Their material is now `visible: false`: they are never
//     rendered, but Raycaster ignores material visibility so they
//     stay clickable. Pixel-identical.
//   - All arcs share one solid and one dashed line material, and all
//     tubes share one material (previously one per arc / per tube).
//   - ALL visible arcs are now batched into just two LineSegments objects
//     (one solid, one dashed) built at the end of rebuildArcs(), instead
//     of one THREE.Line (= one draw call) per arc. The dashed batch gets
//     a hand-built `lineDistance` attribute (cumulative per arc), so the
//     dash pattern is identical to the old per-arc lines. Because the
//     arcs no longer belong to a single node, `node.skyLines` stays empty;
//     the batches live in `tree.arcLineObjects`.
//   - Click tubes use 10 tubular x 6 radial segments (was 20 x 8).
// ============================================================

import * as THREE from 'three';
import AppState from './appState.js';
import { TreeNode } from './TreeNode.js';
import { computePanCamera } from './cameraControls.js';
import { NODE_DATA_URL } from './constants.js';
import { handleTreesphereClick, handleEditModeConnectionClick } from './editMode.js';
import { applyNodeEffect, removeNodeEffect, refreshPerksTaken } from './perkEffects.js';
import { CharacterState, computeStatValue } from './characterState.js';
import { Group } from './Group.js';
import { GROUP_PAN_MIN_FOV, MIN_CAMERA_FOV, MAX_CAMERA_FOV } from './constants.js';

// ---- Shared materials for arcs / click tubes ---------------------------
const SOLID_ARC_MATERIAL  = new THREE.LineBasicMaterial({ color: 0x666666 });
const DASHED_ARC_MATERIAL = new THREE.LineDashedMaterial({ color: 0x666666, dashSize: 0.01, gapSize: 0.01 });
// Never drawn (visible:false) — only ever used as a raycast target.
const TUBE_MATERIAL = new THREE.MeshBasicMaterial({
    wireframe: true, opacity: 0.0, transparent: true, depthWrite: false, visible: false,
});

function isCharacteristicReq(req) {
    return !!req && typeof req === 'object' && !Array.isArray(req) && req.type === 'characteristic';
}

/** Reads a node's effects off either the array format or the older single-object format. */
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
        this.mutExclGroups = [];   // [{ label, max, members }, …]
        this.nodeIDs       = [];   // sparse map: nodeId → index in this.nodes
        this.span          = [smolFi, highFi, smolTh, highTh];
        this.groups = [];           // Group[]

        // Arc batching (see header). Filled by createLinesNTubes(), flushed by rebuildArcs().
        this.arcLineObjects = [];   // the LineSegments currently in the scene
        this._solidArcPos = [];     // flat xyz pairs, 2 points per segment
        this._dashedArcPos = [];
        this._dashedArcDist = [];   // lineDistance per vertex, matching _dashedArcPos

        this.sphereRadius = 30;

        // Semi-transparent debug sphere showing the tree's extent. Must be
        // DoubleSide: the camera sits at its centre, so every ray hits the
        // BACK face (see the original note in handleTreesphereClick()).
        this.treesphere = new THREE.Mesh(
            new THREE.SphereGeometry(this.sphereRadius, 32, 16),
                                         new THREE.MeshBasicMaterial({ color: 'black', transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        this.treesphere.onClick = (hit) => {
            if (AppState.editMode) {
                handleTreesphereClick(hit);
                return;
            }
            this._handleGroupPanClick(hit);
        };
        AppState.scene.add(this.treesphere);
    }

    // ----------------------------------------------------------------
    // resolveNode  (defensive lookup)
    // ----------------------------------------------------------------

    /** Safely resolves a node by id; logs once per bad id and returns undefined instead of crashing callers. */
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
    // areReqsMet
    // ----------------------------------------------------------------

    areReqsMet(reqs) {
        for (const req of reqs) {
            if (Array.isArray(req)) {
                const allInactive = req.every(id => {
                    const node = this.resolveNode(id);
                    return !node || !node.nodeActive;
                });
                if (allInactive) return false;

            } else if (isCharacteristicReq(req)) {
                const field = CharacterState.characteristics[req.stat];
                const { value } = computeStatValue(field);
                if (!(value >= req.min)) return false;

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
        const path = new THREE.CatmullRomCurve3(pnts);

        // Accumulate this arc as line SEGMENTS into the shared batch (flushed
        // into two LineSegments objects by rebuildArcs()).
        const arcPoints = path.getPoints(50);
        const batchPos  = dashed ? this._dashedArcPos : this._solidArcPos;
        let runLength = 0;
        for (let i = 0; i < arcPoints.length - 1; i++) {
            const p = arcPoints[i], q = arcPoints[i + 1];
            batchPos.push(p.x, p.y, p.z, q.x, q.y, q.z);
            if (dashed) {
                const next = runLength + p.distanceTo(q);
                this._dashedArcDist.push(runLength, next); // cumulative distance along THIS arc
                runLength = next;
            }
        }

        // Split arc into two invisible click-target tubes
        const pnts1h = [], pnts2h = [];
        const mid = Math.floor(pnts.length / 2);
        for (let i = 0; i <= mid + 1 && i < pnts.length; i++) pnts1h.push(pnts[i]);
        for (let i = mid + 1; i < pnts.length; i++)            pnts2h.push(pnts[i]);

        const mesh1h = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pnts1h), 10, 0.02, 6, false),
            TUBE_MATERIAL
        );
        mesh1h.isReqTube = true;
        const mesh2h = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pnts2h), 10, 0.01, 6, false),
            TUBE_MATERIAL
        );
        mesh2h.isReqTube = true;

        const self = this;

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
    // init / arcs
    // ----------------------------------------------------------------

    /** Builds the nodeIDs map, then draws every requirement arc. */
    init() {
        for (let i = 0; i < this.nodes.length; i++) {
            this.nodeIDs[this.nodes[i].nodeId] = i;
        }
        this.rebuildArcs();
    }

    /** Removes every drawn arc/tube pair from the scene (geometry is disposed; materials are shared). */
    clearArcs() {
        for (const obj of this.arcLineObjects) {
            AppState.scene.remove(obj);
            obj.geometry.dispose();
        }
        this.arcLineObjects = [];
        this._solidArcPos = [];
        this._dashedArcPos = [];
        this._dashedArcDist = [];

        for (const node of this.nodes) {
            for (const line of node.skyLines) {
                AppState.scene.remove(line);
                line.geometry.dispose();
            }
            for (const pair of node.reqTubes) {
                AppState.scene.remove(pair[0]);
                AppState.scene.remove(pair[1]);
                pair[0].geometry.dispose();
                pair[1].geometry.dispose();
            }
            node.skyLines = [];
            node.reqTubes = [];
        }
    }

    /**
     * (Re)draws every requirement arc from each node's CURRENT position.
     * A requirement id that doesn't resolve is logged and just that one
     * arc is skipped.
     */
    rebuildArcs() {
        this.clearArcs();

        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = 0; j < this.nodes[i].requires.length; j++) {
                const req = this.nodes[i].requires[j];
                if (isCharacteristicReq(req)) continue;
                const endD = new THREE.Vector3();
                this.nodes[i].star.getWorldPosition(endD);

                if (Array.isArray(req)) {
                    const group = req;
                    for (let k = 0; k < group.length; k++) {
                        const startNode = this.resolveNode(group[k]);
                        if (!startNode) continue;

                        const startT = new THREE.Vector3();
                        const endD2  = new THREE.Vector3();
                        this.nodes[i].star.getWorldPosition(endD2);
                        startNode.star.getWorldPosition(startT);
                        this.createLinesNTubes(startT, endD2, 50, false, true, i, j, k, group);
                    }
                } else {
                    const startNode = this.resolveNode(req);
                    if (!startNode) continue;

                    const startT = new THREE.Vector3();
                    startNode.star.getWorldPosition(startT);
                    this.createLinesNTubes(startT, endD, 50, false, false, i, j, -1, null);
                }
            }
        }

        this._flushArcBatches();
    }

    /** Turns the accumulated arc segments into (at most) two LineSegments objects in the scene. */
    _flushArcBatches() {
        const make = (positions, distances, material) => {
            if (positions.length === 0) return;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            if (distances) geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute(distances, 1));
            const lines = new THREE.LineSegments(geometry, material);
            lines.frustumCulled = false; // the camera sits inside this shell; always visible
            AppState.scene.add(lines);
            this.arcLineObjects.push(lines);
        };

        make(this._solidArcPos, null, SOLID_ARC_MATERIAL);
        make(this._dashedArcPos, this._dashedArcDist, DASHED_ARC_MATERIAL);

        this._solidArcPos = [];
        this._dashedArcPos = [];
        this._dashedArcDist = [];
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    /** @returns {THREE.Vector2} x = fi, y = theta */
    getNodeSphericalCoordinates(ID) {
        const node = this.resolveNode(ID);
        if (!node) return new THREE.Vector2(0, 0);
        return new THREE.Vector2(node.getFi(), node.getTheta());
    }

    getNodeWorldPosition(ID) {
        const v = new THREE.Vector3();
        const node = this.resolveNode(ID);
        if (node) node.getWorldPosition(v);
        return v;
    }

    /** Serializes the tree back into the nodes.json shape (edit-mode Export). */
    toJSON() {
        const groups = new Set();
        for (const n of this.nodes) if (n.excl) groups.add(n.excl);

        return {
            nodes: this.nodes.map(n => n.toJSON()),
            mutuallyExclusive: Array.from(groups).map(g => ({
                label: g.label,
                max: g.max,
                members: [...g.members],
            })),
            groups: this.groups.map(g => g.toJSON()),
        };
    }

    // ----------------------------------------------------------------
    // Editor mutations
    // ----------------------------------------------------------------

    /** Inverse of the x/y/z math in treeGen(): world point on the sphere → fi/theta degrees. */
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
     * Non-edit-mode treesphere click: when zoomed out far enough and the
     * click didn't ALSO hit a node or requirement tube, pans/zooms to the
     * group whose click area contains the point.
     */
    _handleGroupPanClick(hit) {
        if (AppState.camera.fov < GROUP_PAN_MIN_FOV) return;
        if (AppState.panCamBool || AppState.zoomCamBool) return;

        const alsoHitNodeOrArc = AppState.intersects.some(i =>
            i.object && (i.object.nodeId !== undefined || i.object.isReqTube)
        );
        if (alsoHitNodeOrArc) return;

        const { fiDeg, thetaDeg } = this.worldPointToFiTheta(hit.point);
        const group = this.findGroupAtPoint(fiDeg, thetaDeg);
        if (!group) return;

        const fiRad = -(group.center.fi * Math.PI / 180);
        const thetaRad = group.center.theta * Math.PI / 180;

        const aspect = AppState.container.clientWidth / Math.max(AppState.container.clientHeight, 1);
        const fitFov = group.computeFitFov(aspect);
        const targetFov = fitFov === null
            ? null
            : Math.max(MIN_CAMERA_FOV, Math.min(MAX_CAMERA_FOV, fitFov));

        AppState.panCamBool = true;
        computePanCamera(
            AppState.camera.rotation.x,
            AppState.camera.rotation.y,
            thetaRad,
            fiRad - Math.PI / 2,
            targetFov
        );
    }

    resolveGroup(id) {
        return this.groups.find(g => g.id === String(id));
    }

    findGroupAtPoint(fiDeg, thetaDeg) {
        return this.groups.find(g => g.containsPoint(fiDeg, thetaDeg));
    }

    /** Creates and registers a new Group. @returns {Group|null} null if `id` was taken */
    addGroup(data) {
        const id = (data.id !== undefined && data.id !== null && data.id !== '')
            ? String(data.id)
            : `group-${Date.now()}`;

        if (this.resolveGroup(id)) {
            console.error(`Tree.addGroup: id "${id}" is already in use — pick a different id.`);
            return null;
        }

        const group = new Group(id, data.center, data.label, data.clickArea, this.sphereRadius);
        this.groups.push(group);
        return group;
    }

    updateGroup(id, data) {
        const group = this.resolveGroup(id);
        if (!group) return false;

        if (data.center) group.center = { fi: Number(data.center.fi) || 0, theta: Number(data.center.theta) || 0 };
        if (data.label) {
            group.label = {
                text: data.label.text || '',
                fi: Number(data.label.fi) || 0,
                theta: Number(data.label.theta) || 0,
            };
        }
        if (Array.isArray(data.clickArea)) {
            group.clickArea = data.clickArea.map(r => ({
                fiMin: Number(r.fiMin) || 0, fiMax: Number(r.fiMax) || 0,
                thetaMin: Number(r.thetaMin) || 0, thetaMax: Number(r.thetaMax) || 0,
            }));
        }
        group.refreshLabel();
        return true;
    }

    removeGroup(id) {
        const idx = this.groups.findIndex(g => g.id === String(id));
        if (idx === -1) return false;
        this.groups[idx].dispose();
        this.groups.splice(idx, 1);
        return true;
    }

    /**
     * Creates and inserts a new TreeNode from edit-mode's "Add Node" form.
     * @param {object} data - {id?, name, desc, hoverText, cost, temperature, fi, theta, exclGroup?, effects?} (fi/theta in DEGREES)
     * @returns {TreeNode|null} null if `id` was already taken
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

    /** Appends a requirement entry (id = AND, id[] = OR) and redraws arcs. */
    addRequirement(nodeId, reqEntry) {
        const node = this.resolveNode(nodeId);
        if (!node) return false;
        node.requires.push(reqEntry);
        this.rebuildArcs();
        return true;
    }

    /** Removes one requirement entry by index and redraws arcs. */
    removeRequirement(nodeId, reqIndex) {
        const node = this.resolveNode(nodeId);
        if (!node || node.requires[reqIndex] === undefined) return false;
        node.requires.splice(reqIndex, 1);
        this.rebuildArcs();
        return true;
    }

    /** Appends one effect; if the node is active its contribution is removed and re-applied so nothing double-counts. */
    addNodeEffect(nodeId, effect) {
        const node = this.resolveNode(nodeId);
        if (!node) return false;

        if (node.nodeActive) removeNodeEffect(node);
        node.effects = [...node.effects, effect];
        if (node.nodeActive) applyNodeEffect(node);

        return true;
    }

    /** Removes one effect by index (same live-edit pattern as removeRequirement()). */
    removeNodeEffectAt(nodeId, effectIndex) {
        const node = this.resolveNode(nodeId);
        if (!node || node.effects[effectIndex] === undefined) return false;

        if (node.nodeActive) removeNodeEffect(node);
        node.effects = node.effects.filter((_, i) => i !== effectIndex);
        if (node.nodeActive) applyNodeEffect(node);

        return true;
    }

    /** Replaces one effect in place (keeps its position in the list). */
    updateNodeEffectAt(nodeId, effectIndex, effect) {
        const node = this.resolveNode(nodeId);
        if (!node || node.effects[effectIndex] === undefined) return false;

        if (node.nodeActive) removeNodeEffect(node);
        node.effects = node.effects.map((e, i) => (i === effectIndex ? effect : e));
        if (node.nodeActive) applyNodeEffect(node);

        return true;
    }

    /**
     * Deletes a node: removes its meshes and arcs, scrubs every other
     * node's `requires` of references to it, fixes its exclusion group,
     * removes its sheet contribution if active, rebuilds nodeIDs and arcs.
     * (Its StarModel stays in AppState.starClasses — other nodes' starID
     * values index into that array.)
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
     * Assigns, reassigns, or clears a node's mutual-exclusion group and
     * sets that group's `max`. Empty groups are dropped.
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
// treeGen — loads nodes.json and fills `tree` with TreeNode instances.
// fi / theta in the JSON are degrees within the tree's angular span.
// ============================================================

export async function treeGen(tree) {

    const res  = await fetch(NODE_DATA_URL);
    const data = await res.json();

    // ---- Mutually-exclusive groups (shared objects) --------------------
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

    // ---- Nodes -----------------------------------------------------------
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

    // ---- Groups -----------------------------------------------------------
    tree.groups = (data.groups || []).map(g =>
        new Group(g.id, g.center, g.label, g.clickArea, tree.sphereRadius)
    );

    AppState.cameraRotationOffsetFromTree = -Math.PI / 2;
}
