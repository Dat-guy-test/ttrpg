// ============================================================
// StarModel
//
// Manages the animated lava-shader material applied to a skill
// node's star mesh when that node is activated.
//
// Pipeline:
//   1. Load 'sun.jpg' (surface texture) and 'cloud.png' (noise).
//   2. Recolour sun.jpg to match the node's blackbody temperature
//      using computeStarHSL() from colorScience.js.
//   3. Build a custom ShaderMaterial with the recoloured textures.
//   4. Set isReady = true so the animate() loop can start
//      incrementing the `time` uniform.
//
// StarModel is deliberately AppState-free: it loads textures and
// builds a material — it never touches the scene, camera, or any
// other global state.  TreeNode owns the star mesh and decides
// when to swap in this material.
// ============================================================

import * as THREE from 'three';
import { computeStarHSL, hslToRgb } from './colorScience.js';


export class StarModel {
    /**
     * @param {number} temperature - Blackbody temperature in Kelvin
     *                               (e.g. 3000 K = red-orange, 10 000 K = blue-white)
     */
    constructor(temperature) {
        this.temperature = temperature;

        // Shader animation parameters (become GLSL uniforms)
        this.baseSpeed   = 0.0001; // Speed of base texture UV scroll
        this.repeatS     = 1.0;    // UV tiling — S axis
        this.repeatT     = 1.0;    // UV tiling — T axis
        this.noiseScale  = 0.9;    // Distortion strength applied by the noise layer
        this.blendSpeed  = 0.03;   // Speed of secondary (blend) texture scroll
        this.blendOffset = 0.6;    // Brightness subtracted from the blend layer
        this.bumpSpeed   = 0.06;   // Speed of the vertex-displacement texture scroll
        this.bumpScale   = 0.0025; // Magnitude of per-vertex displacement

        this.isReady = false; // Becomes true once textures are loaded and material built

        this.loadTextures()
        .then(() => { this.createMaterial(); this.isReady = true; })
        .catch(err => console.error('StarModel: error loading textures:', err));
    }

    // ------------------------------------------------------------------
    // Texture loading
    // ------------------------------------------------------------------

    /**
     * Loads sun.jpg and cloud.png, recolours sun.jpg for this star's
     * temperature, then wires all four texture slots and resolves.
     * @returns {Promise<void>}
     */
    loadTextures() {
        return new Promise((resolve, reject) => {
            Promise.all([
                this.loadTexture(`${import.meta.env.BASE_URL}sun.jpg`),
                        this.loadTexture(`${import.meta.env.BASE_URL}cloud.png`),
            ])
            .then(([lavaTexture, noiseTexture]) => {
                this.modifyLavaTexture(lavaTexture, this.temperature)
                .then(modified => {
                    this.lavaTexture  = modified;
                    this.noiseTexture = noiseTexture;
                    this.blendTexture = this.lavaTexture;   // blend reuses the coloured surface
                    this.bumpTexture  = this.noiseTexture;  // bump reuses noise

                    // All four textures must repeat for the scrolling shader to tile correctly
                    for (const tex of [this.lavaTexture, this.noiseTexture,
                        this.blendTexture, this.bumpTexture]) {
                        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                        }
                        resolve();
                })
                .catch(reject);
            })
            .catch(reject);
        });
    }

    /**
     * Wraps THREE.TextureLoader.load() in a Promise.
     * @param {string} url
     * @returns {Promise<THREE.Texture>}
     */
    loadTexture(url) {
        return new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(
                url,
                tex => resolve(tex),
                                           undefined,
                                           ()  => reject(new Error(`StarModel: failed to load texture "${url}"`))
            );
        });
    }

    /**
     * Recolours every pixel in `texture` to match this star's blackbody temperature.
     *
     * Uses computeStarHSL() from colorScience.js to get the target [h, s, l].
     * Then for each pixel it replaces hue and saturation while scaling lightness
     * by the pixel's original greyscale brightness, preserving all surface detail.
     *
     * @param {THREE.Texture} texture
     * @param {number}        temperature  — Kelvin
     * @returns {Promise<THREE.CanvasTexture>}
     */
    modifyLavaTexture(texture, temperature) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx    = canvas.getContext('2d');
            canvas.width  = texture.image.width;
            canvas.height = texture.image.height;
            ctx.drawImage(texture.image, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data; // flat RGBA array

            // Full CIE / Planck pipeline lives in colorScience.js
            const [h, s, l] = computeStarHSL(temperature);

            for (let i = 0; i < data.length; i += 4) {
                const bri = ((data[i] + data[i + 1] + data[i + 2]) / 3) / 255; // greyscale [0,1]
                const [r, g, b] = hslToRgb(h, s, l * bri);
                data[i]     = Math.floor(255 * r);
                data[i + 1] = Math.floor(255 * g);
                data[i + 2] = Math.floor(255 * b);
                // alpha (data[i+3]) is intentionally left unchanged
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(new THREE.CanvasTexture(canvas));
        });
    }

    // ------------------------------------------------------------------
    // Material
    // ------------------------------------------------------------------

    /**
     * Builds the GLSL ShaderMaterial for the animated star surface.
     *
     * Vertex shader:  samples the noise texture for per-vertex displacement
     *                 along the surface normal, creating a "churning" effect.
     * Fragment shader: samples the base texture through two independently-
     *                  scrolling, noise-distorted UV sets and additively blends them.
     *                  The `time` uniform is incremented each frame by animate().
     */
    createMaterial() {
        this.customUniforms = {
            baseTexture:  { type: 't', value: this.lavaTexture },
            baseSpeed:    { type: 'f', value: this.baseSpeed },
            repeatS:      { type: 'f', value: this.repeatS },
            repeatT:      { type: 'f', value: this.repeatT },
            noiseTexture: { type: 't', value: this.noiseTexture },
            noiseScale:   { type: 'f', value: this.noiseScale },
            blendTexture: { type: 't', value: this.blendTexture },
            blendSpeed:   { type: 'f', value: this.blendSpeed },
            blendOffset:  { type: 'f', value: this.blendOffset },
            bumpTexture:  { type: 't', value: this.bumpTexture },
            bumpSpeed:    { type: 'f', value: this.bumpSpeed },
            bumpScale:    { type: 'f', value: this.bumpScale },
            alpha:        { type: 'f', value: 1.0 },
            time:         { type: 'f', value: 1.0 },
        };

        this.customMaterial = new THREE.ShaderMaterial({
            uniforms: this.customUniforms,

            vertexShader: `
            uniform sampler2D noiseTexture;
            uniform float     noiseScale;
            uniform sampler2D bumpTexture;
            uniform float     bumpSpeed;
            uniform float     bumpScale;
            uniform float     time;
            varying vec2 vUv;

            void main() {
                vUv = uv;

                vec2 uvTimeShift = vUv + vec2(1.1, 1.9) * time * bumpSpeed;
                vec4 noiseGeneratorTimeShift = texture2D(noiseTexture, uvTimeShift);
                vec4 bumpData = texture2D(bumpTexture, uvTimeShift);

                // At UV poles the texture degenerates; use a simple sinusoidal wobble instead
                float displacement = (vUv.y > 0.999 || vUv.y < 0.001)
                ? bumpScale * (0.3 + 0.02 * sin(time))
                : bumpScale * bumpData.r;

                vec3 newPosition = position + normal * displacement;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
            `,

            fragmentShader: `
            uniform sampler2D baseTexture;
            uniform float     baseSpeed;
            uniform float     repeatS;
            uniform float     repeatT;
            uniform sampler2D noiseTexture;
            uniform float     noiseScale;
            uniform sampler2D blendTexture;
            uniform float     blendSpeed;
            uniform float     blendOffset;
            uniform float     time;
            uniform float     alpha;
            varying vec2 vUv;

            void main() {
                // Base layer: scroll in one direction, distort through noise r/b channels
                vec2 uvTimeShift  = vUv + vec2(-0.7, 1.5) * time * baseSpeed;
                vec4 noise1       = texture2D(noiseTexture, uvTimeShift);
                vec2 uvNoise1     = vUv + noiseScale * vec2(noise1.r, noise1.b);
                vec4 baseColor    = texture2D(baseTexture, uvNoise1 * vec2(repeatS, repeatT));

                // Blend layer: scroll in opposite direction, distort through noise g/b channels
                vec2 uvTimeShift2 = vUv + vec2(1.3, -1.7) * time * blendSpeed;
                vec4 noise2       = texture2D(noiseTexture, uvTimeShift2);
                vec2 uvNoise2     = vUv + noiseScale * vec2(noise2.g, noise2.b);
                vec4 blendColor   = texture2D(blendTexture, uvNoise2 * vec2(repeatS, repeatT))
                - blendOffset * vec4(1.0);

                vec4 theColor = baseColor + blendColor;
                theColor.a    = alpha;
                gl_FragColor  = theColor;
            }
            `,
        });

        this.customMaterial.transparent = true;
        this.customMaterial.opacity     = 0.9;
        this.customMaterial.needsUpdate = true;
    }

    /** True once all textures are loaded and the ShaderMaterial is built. */
    isModelReady() { return this.isReady; }
}
