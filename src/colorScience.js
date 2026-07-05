// ============================================================
// COLOR SCIENCE
// CIE 1931 / blackbody colour pipeline.
//
// Based on John Walker's "Colour Rendering of Spectra":
//   https://www.fourmilab.ch/documents/specrend/
//
// These were previously defined as local functions nested
// inside StarModel.modifyLavaTexture().  They live here so
// that StarModel (and any future code) can import them cleanly.
// ============================================================


// ============================================================
// ColourSystem
// Represents an RGB colour primaries + white point for a
// display standard (NTSC, SMPTE, Rec.709, etc.).
// ============================================================
export class ColourSystem {
    /**
     * @param {string} name
     * @param {number} xRed   @param {number} yRed
     * @param {number} xGreen @param {number} yGreen
     * @param {number} xBlue  @param {number} yBlue
     * @param {number} xWhite @param {number} yWhite
     * @param {number} gamma  Use GAMMA_REC709 (0) for the Rec.709 transfer function
     */
    constructor(name, xRed, yRed, xGreen, yGreen, xBlue, yBlue, xWhite, yWhite, gamma) {
        this.name   = name;
        this.xRed   = xRed;   this.yRed   = yRed;
        this.xGreen = xGreen; this.yGreen = yGreen;
        this.xBlue  = xBlue;  this.yBlue  = yBlue;
        this.xWhite = xWhite; this.yWhite = yWhite;
        this.gamma  = gamma;
    }
}


// ============================================================
// CIE standard illuminant chromaticities
// ============================================================
export const IlluminantC   = [0.3101, 0.3162];
export const IlluminantD65 = [0.3127, 0.3291];
export const IlluminantE   = [0.33333333, 0.33333333];

/** Sentinel value: use the Rec.709 piecewise transfer function instead of a plain power-law gamma. */
export const GAMMA_REC709 = 0;


// ============================================================
// Pre-built colour system definitions
// ============================================================
export const NTSCsystem   = new ColourSystem("NTSC",           0.67,   0.33,   0.21,   0.71,   0.14,   0.08,   ...IlluminantC,   GAMMA_REC709);
export const EBUsystem    = new ColourSystem("EBU (PAL/SECAM)", 0.64,   0.33,   0.29,   0.60,   0.15,   0.06,   ...IlluminantD65, GAMMA_REC709);
export const SMPTEsystem  = new ColourSystem("SMPTE",           0.630,  0.340,  0.310,  0.595,  0.155,  0.070,  ...IlluminantD65, GAMMA_REC709);
export const HDTVsystem   = new ColourSystem("HDTV",            0.670,  0.330,  0.210,  0.710,  0.150,  0.060,  ...IlluminantD65, GAMMA_REC709);
export const CIEsystem    = new ColourSystem("CIE",             0.7355, 0.2645, 0.2658, 0.7243, 0.1669, 0.0085, ...IlluminantE,   GAMMA_REC709);
export const Rec709system = new ColourSystem("CIE REC 709",     0.64,   0.33,   0.30,   0.60,   0.15,   0.06,   ...IlluminantD65, GAMMA_REC709);


// ============================================================
// Chromaticity conversions (u'v' ↔ xy)
// Included for completeness; not used in the main pipeline.
// ============================================================

/** Converts CIE u'v' uniform-chromaticity coordinates to xy. */
export function upvpToXY(up, vp) {
    const xc = (9 * up) / ((6 * up) - (16 * vp) + 12);
    const yc = (4 * vp) / ((6 * up) - (16 * vp) + 12);
    return [xc, yc];
}

/** Converts CIE xy chromaticity coordinates to u'v'. */
export function xyToUpvp(xc, yc) {
    const up = (4 * xc) / ((-2 * xc) + (12 * yc) + 3);
    const vp = (9 * yc) / ((-2 * xc) + (12 * yc) + 3);
    return [up, vp];
}


// ============================================================
// XYZ → linear RGB
// ============================================================

/**
 * Converts CIE XYZ to linear RGB using the specified ColourSystem's primary matrices.
 * Builds a 3×3 chromatic adaptation matrix and applies it.
 *
 * @param {ColourSystem} cs
 * @param {number} xc @param {number} yc @param {number} zc  — CIE XYZ tristimulus values
 * @returns {number[]} [r, g, b]  linear, possibly out-of-gamut
 */
export function xyzToRgb(cs, xc, yc, zc) {
    const xr = cs.xRed,   yr = cs.yRed,   zr = 1 - (xr + yr);
    const xg = cs.xGreen, yg = cs.yGreen, zg = 1 - (xg + yg);
    const xb = cs.xBlue,  yb = cs.yBlue,  zb = 1 - (xb + yb);
    const xw = cs.xWhite, yw = cs.yWhite, zw = 1 - (xw + yw);

    var rx = (yg * zb) - (yb * zg), ry = (xb * zg) - (xg * zb), rz = (xg * yb) - (xb * yg);
    var gx = (yb * zr) - (yr * zb), gy = (xr * zb) - (xb * zr), gz = (xb * yr) - (xr * yb);
    var bx = (yr * zg) - (yg * zr), by = (xg * zr) - (xr * zg), bz = (xr * yg) - (xg * yr);

    const rw = ((rx * xw) + (ry * yw) + (rz * zw)) / yw;
    const gw = ((gx * xw) + (gy * yw) + (gz * zw)) / yw;
    const bw = ((bx * xw) + (by * yw) + (bz * zw)) / yw;

    // Normalise rows by white-point weights
    rx /= rw; ry /= rw; rz /= rw;
    gx /= gw; gy /= gw; gz /= gw;
    bx /= bw; by /= bw; bz /= bw;

    const r = (rx * xc) + (ry * yc) + (rz * zc);
    const g = (gx * xc) + (gy * yc) + (gz * zc);
    const b = (bx * xc) + (by * yc) + (bz * zc);
    return [r, g, b];
}


// ============================================================
// Gamut helpers
// ============================================================

/** Returns true if all channels are non-negative (colour is within display gamut). */
export function insideGamut(r, g, b) {
    return (r >= 0) && (g >= 0) && (b >= 0);
}

/**
 * Shifts an out-of-gamut colour toward white until all channels ≥ 0.
 * NOTE: JS passes primitives by value, so this returns the corrected
 * values rather than mutating its arguments.
 *
 * @returns {{ r: number, g: number, b: number, corrected: boolean }}
 */
export function constrainRgb(r, g, b) {
    const w = Math.min(0, r, g, b);
    const corrected = w < 0;
    if (corrected) { r -= w; g -= w; b -= w; }
    return { r, g, b, corrected };
}


// ============================================================
// Gamma correction
// ============================================================

/**
 * Applies Rec.709 gamma correction (or a plain power-law gamma) to a single linear channel.
 * @param {ColourSystem} cs
 * @param {number} c  — linear channel value in [0, 1]
 * @returns {number}  — gamma-corrected value
 */
export function gammaCorrect(cs, c) {
    const gamma = cs.gamma;
    if (gamma === GAMMA_REC709) {
        const cc = 0.018;
        if (c < cc) { c *= ((1.099 * Math.pow(cc, 0.45)) - 0.099) / cc; }
        else        { c  = (1.099 * Math.pow(c,  0.45)) - 0.099; }
    } else {
        c = Math.pow(c, 1.0 / gamma);
    }
    return c;
}

/**
 * Applies gamma correction to all three linear RGB channels.
 * @returns {number[]} [r, g, b]
 */
export function gammaCorrectRgb(cs, r, g, b) {
    return [gammaCorrect(cs, r), gammaCorrect(cs, g), gammaCorrect(cs, b)];
}


// ============================================================
// Normalisation
// ============================================================

/**
 * Normalises RGB so the brightest channel becomes 1.0.
 * Ensures the colour is as vivid as possible while preserving hue.
 * @returns {number[]} [r, g, b]
 */
export function normRgb(r, g, b) {
    const greatest = Math.max(r, g, b);
    if (greatest > 0) { return [r / greatest, g / greatest, b / greatest]; }
    return [r, g, b];
}


// ============================================================
// Spectrum → XYZ integration
// ============================================================

/**
 * Integrates a spectral power distribution against CIE 1931 2° colour-matching
 * functions (380–780 nm, 5 nm steps) to produce normalised CIE xy chromaticity.
 *
 * @param {function} specIntens  — function(wavelength_nm) → relative spectral radiance
 * @returns {number[]} [x, y, z]  — normalised chromaticity (z = 1 - x - y implicitly)
 */
export function spectrumToXyz(specIntens) {
    // CIE 1931 2° standard observer colour-matching functions, 380–780 nm in 5 nm steps (81 entries)
    const cieColourMatch = [
        [0.0014, 0.0000, 0.0065], [0.0022, 0.0001, 0.0105], [0.0042, 0.0001, 0.0201],
        [0.0076, 0.0002, 0.0362], [0.0143, 0.0004, 0.0679], [0.0232, 0.0006, 0.1102],
        [0.0435, 0.0012, 0.2074], [0.0776, 0.0022, 0.3713], [0.1344, 0.0040, 0.6456],
        [0.2148, 0.0073, 1.0391], [0.2839, 0.0116, 1.3856], [0.3285, 0.0168, 1.6230],
        [0.3483, 0.0230, 1.7471], [0.3481, 0.0298, 1.7826], [0.3362, 0.0380, 1.7721],
        [0.3187, 0.0480, 1.7441], [0.2908, 0.0600, 1.6692], [0.2511, 0.0739, 1.5281],
        [0.1954, 0.0910, 1.2876], [0.1421, 0.1126, 1.0419], [0.0956, 0.1390, 0.8130],
        [0.0580, 0.1693, 0.6162], [0.0320, 0.2080, 0.4652], [0.0147, 0.2586, 0.3533],
        [0.0049, 0.3230, 0.2720], [0.0024, 0.4073, 0.2123], [0.0093, 0.5030, 0.1582],
        [0.0291, 0.6082, 0.1117], [0.0633, 0.7100, 0.0782], [0.1096, 0.7932, 0.0573],
        [0.1655, 0.8620, 0.0422], [0.2257, 0.9149, 0.0298], [0.2904, 0.9540, 0.0203],
        [0.3597, 0.9803, 0.0134], [0.4334, 0.9950, 0.0087], [0.5121, 1.0000, 0.0057],
        [0.5945, 0.9950, 0.0039], [0.6784, 0.9786, 0.0027], [0.7621, 0.9520, 0.0021],
        [0.8425, 0.9154, 0.0018], [0.9163, 0.8700, 0.0017], [0.9786, 0.8163, 0.0014],
        [1.0263, 0.7570, 0.0011], [1.0567, 0.6949, 0.0010], [1.0622, 0.6310, 0.0008],
        [1.0456, 0.5668, 0.0006], [1.0026, 0.5030, 0.0003], [0.9384, 0.4412, 0.0002],
        [0.8544, 0.3810, 0.0002], [0.7514, 0.3210, 0.0001], [0.6424, 0.2650, 0.0000],
        [0.5419, 0.2170, 0.0000], [0.4479, 0.1750, 0.0000], [0.3608, 0.1382, 0.0000],
        [0.2835, 0.1070, 0.0000], [0.2187, 0.0816, 0.0000], [0.1649, 0.0610, 0.0000],
        [0.1212, 0.0446, 0.0000], [0.0874, 0.0320, 0.0000], [0.0636, 0.0232, 0.0000],
        [0.0468, 0.0170, 0.0000], [0.0329, 0.0119, 0.0000], [0.0227, 0.0082, 0.0000],
        [0.0158, 0.0057, 0.0000], [0.0114, 0.0041, 0.0000], [0.0081, 0.0029, 0.0000],
        [0.0058, 0.0021, 0.0000], [0.0041, 0.0015, 0.0000], [0.0029, 0.0010, 0.0000],
        [0.0020, 0.0007, 0.0000], [0.0014, 0.0005, 0.0000], [0.0010, 0.0004, 0.0000],
        [0.0007, 0.0002, 0.0000], [0.0005, 0.0002, 0.0000], [0.0003, 0.0001, 0.0000],
        [0.0002, 0.0001, 0.0000], [0.0002, 0.0001, 0.0000], [0.0001, 0.0000, 0.0000],
        [0.0001, 0.0000, 0.0000], [0.0001, 0.0000, 0.0000], [0.0000, 0.0000, 0.0000],
    ];

    let X = 0, Y = 0, Z = 0;
    for (let i = 0, lambda = 380; lambda < 780.1; i++, lambda += 5) {
        const Me = specIntens(lambda);
        X += Me * cieColourMatch[i][0];
        Y += Me * cieColourMatch[i][1];
        Z += Me * cieColourMatch[i][2];
    }
    const XYZ = X + Y + Z;
    return [X / XYZ, Y / XYZ, Z / XYZ]; // Normalised chromaticity
}


// ============================================================
// Planck blackbody spectrum
// ============================================================

/**
 * Planck's law: spectral radiance of a blackbody at a given wavelength and temperature.
 * Returns relative radiance (absolute scale doesn't matter for colour computation).
 *
 * @param {number} wavelength  — in nanometres
 * @param {number} bbTemp      — blackbody temperature in Kelvin
 * @returns {number}  relative spectral radiance
 */
export function bbSpectrum(wavelength, bbTemp) {
    const wlm = wavelength * 1e-9; // nm → metres
    return (3.74183e-16 * Math.pow(wlm, -5.0)) / (Math.exp(1.4388e-2 / (wlm * bbTemp)) - 1.0);
}


// ============================================================
// HSL ↔ RGB conversions
// ============================================================

/**
 * Converts an sRGB colour (0–255 per channel) to HSL.
 * @returns {number[]} [h, s, l]  h ∈ [0,1), s ∈ [0,1], l ∈ [0,1]
 */
export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // Achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2;                break;
            case b: h = (r - g) / d + 4;                break;
        }
        h /= 6;
    }
    return [h, s, l];
}

/**
 * Converts HSL to RGB (channels in [0, 1] range, NOT 0–255).
 * @param {number} h @param {number} s @param {number} l
 * @returns {number[]} [r, g, b]  each in [0, 1]
 */
export function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l; // Achromatic
    } else {
        /** Wraps a hue value into the correct colour sextant. */
        function hue2rgb(p, q, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
}


// ============================================================
// High-level convenience export
// ============================================================

/**
 * Computes the HSL colour of a blackbody star at the given temperature.
 *
 * Pipeline:
 *   Planck spectrum → CIE XYZ (spectrumToXyz) →
 *   linear RGB (xyzToRgb, SMPTE primaries) →
 *   normalise to [0,1] (normRgb) →
 *   scale to 0–255 →
 *   HSL (rgbToHsl)
 *
 * @param {number} temperature  — blackbody temperature in Kelvin (e.g. 3000 = red, 10000 = blue-white)
 * @returns {number[]} [h, s, l]
 */
export function computeStarHSL(temperature) {
    const cs = SMPTEsystem;
    const [x, y, z] = spectrumToXyz(lambda => bbSpectrum(lambda, temperature));
    let [r, g, b] = xyzToRgb(cs, x, y, z);
    [r, g, b] = normRgb(r, g, b);
    r = Math.floor(255 * r);
    g = Math.floor(255 * g);
    b = Math.floor(255 * b);
    return rgbToHsl(r, g, b);
}

