// ============================================================
// CONSTANTS
// Fixed values shared across the application.
// Import from here rather than hard-coding magic numbers.
// ============================================================

/**
 * Three.js layer index for the SelectiveBloomEffect selection set.
 * Any mesh assigned to this layer will glow; everything else will not.
 */
export const BLOOM_LAYER = 2;

/**
 * Where treeGen() fetches the skill-tree data from.
 *
 * nodes.json lives in `public/nodes.json`. Vite serves everything in
 * `public/` unchanged from the site root, but that root shifts when
 * `base` is set (see vite.config.js — GitHub Pages needs a repo-name
 * prefix in production). import.meta.env.BASE_URL always reflects
 * the CURRENT base ('/' in dev, '/your-repo-name/' in a Pages build),
 * so building the URL from it works correctly in both npm run dev
 * and the deployed site without ever hardcoding a prefix here.
 */
export const NODE_DATA_URL = `${import.meta.env.BASE_URL}nodes.json`;

