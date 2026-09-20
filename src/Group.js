// ============================================================
// Group
//
// A named cluster of skill-tree nodes on the sphere. A Group is NOT
// a clickable 3D mesh like TreeNode — its "click area" is a set of
// fi/theta ranges (see containsPoint()) tested against the point
// where a click ray hits the tree's invisible debug sphere (see
// Tree.js's treesphere.onClick / _handleGroupPanClick()). This keeps
// a group's clickable footprint fully data-driven and editable in
// edit mode, independent of any particular mesh geometry.
//
// A Group owns exactly one visual: a troika-three-text label placed
// at its `label` fi/theta — independent of `center`, which is only
// ever used as the camera-pan target once a click lands in the
// group's area.
// ============================================================

import * as THREE from 'three';
import { LABEL_FONT_URL, GROUP_FIT_MARGIN } from './constants.js';
import { Text } from 'troika-three-text';
import AppState from './appState.js';

export class Group {
    /**
     * @param {string|number} id
     * @param {{fi:number, theta:number}} center — degrees
     * @param {{text:string, fi:number, theta:number}} label — degrees
     * @param {{fiMin:number, fiMax:number, thetaMin:number, thetaMax:number}[]} clickArea
     * @param {number} sphereRadius — Tree.sphereRadius, used to place the label mesh
     */
    constructor(id, center, label, clickArea, sphereRadius) {
        this.id = String(id);
        this.center = { fi: Number(center?.fi) || 0, theta: Number(center?.theta) || 0 };
        this.label = {
            text: (label && label.text) || '',
            fi: Number(label?.fi) || 0,
            theta: Number(label?.theta) || 0,
        };
        this.clickArea = Array.isArray(clickArea) ? clickArea.map(r => ({
            fiMin: Number(r.fiMin) || 0, fiMax: Number(r.fiMax) || 0,
            thetaMin: Number(r.thetaMin) || 0, thetaMax: Number(r.thetaMax) || 0,
        })) : [];

        this.sphereRadius = sphereRadius;
        this.labelText = null;
        this._buildLabel();
    }

    _buildLabel() {
        const text = new Text();
        text.text = this.label.text;
        text.font = LABEL_FONT_URL;
        text.fontSize = 0.02;
        text.color = 0xfafafa;
        text.outlineWidth = '0%';
        text.outlineColor = 0xfafafa;
        text.anchorX = 'center';
        text.anchorY = 'middle';
        this._positionLabel(text);
        text.sync();
        AppState.scene.add(text);
        this.labelText = text;
    }

    /**
     * Places `text` at this group's label fi/theta on the sphere,
     * using the SAME (non-negated) fi convention treeGen()/Tree.addNode()
     * use for a node's world position — unlike TreeNode.fi, which is
     * stored negated for its own internal offset/pan-target math.
     */
    _positionLabel(text) {
        const fiRad = this.label.fi * Math.PI / 180;
        const thRad = this.label.theta * Math.PI / 180;
        const R = this.sphereRadius;
        const x = R * Math.cos(thRad) * Math.cos(fiRad);
        const y = R * Math.sin(thRad);
        const z = R * Math.cos(thRad) * Math.sin(fiRad);
        text.position.set(x, y, z);
        const outward = text.position.clone().multiplyScalar(0.5);
        text.lookAt(outward);
    }

    /** Re-syncs the label mesh after `this.label` changes (edit mode). */
    refreshLabel() {
        if (!this.labelText) return;
        this.labelText.text = this.label.text;
        this._positionLabel(this.labelText);
        this.labelText.sync();
    }

    /** Removes this group's label mesh from the scene. Call before discarding a Group instance. */
    dispose() {
        if (this.labelText) {
            AppState.scene.remove(this.labelText);
            this.labelText = null;
        }
    }

    /**
     * @param {number} fiDeg
     * @param {number} thetaDeg
     * @returns {boolean} whether the point falls inside any of this group's click-area ranges.
     */
    containsPoint(fiDeg, thetaDeg) {
        return this.clickArea.some(r =>
        fiDeg >= Math.min(r.fiMin, r.fiMax) && fiDeg <= Math.max(r.fiMin, r.fiMax) &&
        thetaDeg >= Math.min(r.thetaMin, r.thetaMax) && thetaDeg <= Math.max(r.thetaMin, r.thetaMax)
        );
    }
    /**
     * Step 1: lowest/highest fi and theta across ALL click-area ranges.
     * @returns {{fiMin:number, fiMax:number, thetaMin:number, thetaMax:number}|null}
     */
    getBounds() {
        if (this.clickArea.length === 0) return null;
        let fiMin = Infinity, fiMax = -Infinity, thetaMin = Infinity, thetaMax = -Infinity;
        for (const r of this.clickArea) {
            fiMin    = Math.min(fiMin,    r.fiMin,    r.fiMax);
            fiMax    = Math.max(fiMax,    r.fiMin,    r.fiMax);
            thetaMin = Math.min(thetaMin, r.thetaMin, r.thetaMax);
            thetaMax = Math.max(thetaMax, r.thetaMin, r.thetaMax);
        }
        return { fiMin, fiMax, thetaMin, thetaMax };
    }

    /**
     * Steps 2–4: the vertical FOV needed to show the group's theta extent,
     * the horizontal FOV needed to show its fi extent (for this aspect
     * ratio), and the larger of the two × margin. Not clamped — the caller
     * applies the camera's min/max FOV (step 5).
     *
     * Done by projecting the bounds' outline into the view of a camera
     * looking at the group center, so the cos(theta) squeeze of longitude
     * near the poles is handled automatically.
     *
     * @param {number} aspect — viewport width / height
     * @param {number} [margin]
     * @returns {number|null} FOV in degrees (Infinity if the area can't fit in front of the camera), or null if the group has no click area
     */
    computeFitFov(aspect, margin = GROUP_FIT_MARGIN) {
        const b = this.getBounds();
        if (!b) return null;

        const D2R = Math.PI / 180;
        // Same world mapping as treeGen(): fi/theta in degrees -> unit vector
        const toVec = (fiDeg, thDeg) => {
            const f = fiDeg * D2R, t = thDeg * D2R;
            return new THREE.Vector3(Math.cos(t) * Math.cos(f), Math.sin(t), Math.cos(t) * Math.sin(f));
        };

        // Camera basis when looking at the group center (no roll, like the main camera)
        const forward = toVec(this.center.fi, this.center.theta);
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
        if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
        right.normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();

        // Sample the bounds' outline (curved on the sphere, so not just corners)
        const N = 8;
        const samples = [];
        for (let i = 0; i <= N; i++) {
            const k = i / N;
            const fi = b.fiMin + (b.fiMax - b.fiMin) * k;
            const th = b.thetaMin + (b.thetaMax - b.thetaMin) * k;
            samples.push([fi, b.thetaMin], [fi, b.thetaMax], [b.fiMin, th], [b.fiMax, th]);
        }

        let tanV = 0; // tan(half vertical angle) needed  -> theta extent
        let tanH = 0; // tan(half horizontal angle) needed -> fi extent
        for (const [fi, th] of samples) {
            const v = toVec(fi, th);
            const z = v.dot(forward);
            if (z < 0.05) return Infinity; // area wraps around/behind the view — can't fit
            tanV = Math.max(tanV, Math.abs(v.dot(up))    / z);
            tanH = Math.max(tanH, Math.abs(v.dot(right)) / z);
        }

        const fovForTheta = 2 * Math.atan(tanV) / D2R;
        // Horizontal half-extent tanH must fit in tan(halfV) * aspect
        const fovForFi    = 2 * Math.atan(tanH / Math.max(aspect, 0.01)) / D2R;

        return Math.max(fovForTheta, fovForFi) * margin;
    }

    /** Serializes back into the nodes.json `groups` entry shape. */
    toJSON() {
        return {
            id: this.id,
            center: { ...this.center },
            label: { ...this.label },
            clickArea: this.clickArea.map(r => ({ ...r })),
        };
    }
     }
