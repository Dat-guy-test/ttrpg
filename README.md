# TTRPG Skill Tree — clean, verified project setup

## Status: builds cleanly ✅

I ran `npm install` and `npm run build` on this exact folder before handing
it back to you — it completed with **zero errors** (33 modules resolved).
Everything that was broken across our conversation is now fixed and
verified, not just "should work."

## Everything that was fixed, in order

1. **`inputHanders.js` → `src/inputHandlers.js`** — typo in the filename
   that `main.js`'s import never matched.
2. **`package.json` had no `scripts` block** — added `dev` / `build` /
   `preview`.
3. **`vite.config.js`** rewritten to key off Vite's `command` parameter
   instead of `process.env.NODE_ENV`, which isn't reliably set the way the
   original assumed. **Set `base` to your actual GitHub repo name** — right
   now it says `'ttrpg-system-website-test'`.
4. **`src/constants.js`**: `NODE_DATA_URL` pointed at a remote GitHub raw
   URL instead of your local `public/nodes.json`. Now built from
   `import.meta.env.BASE_URL` so it works in both dev and the deployed
   build.
5. **`src/sceneSetup.js` / `src/StarModel.js`**: texture/model paths
   (`grass.jpg`, `Telescope.glb`, `sun.jpg`, `cloud.png`) were bare
   filenames that only resolved by accident when `base` was `/`. Same
   `BASE_URL`-based fix applied.
6. **`Stats` import** used a hardcoded `/node_modules/...` path — replaced
   with the proper bare specifier `three/examples/jsm/libs/stats.module.js`.
7. **`postprocessing` was never installed** even though `sceneSetup.js`
   imports `EffectComposer`/`RenderPass`/`SelectiveBloomEffect`/
   `EffectPass` from it — added to `package.json`.
8. **The font import was broken at the root** —
   `three/examples/fonts/helvetiker_regular.typeface.json` doesn't exist in
   the npm `three` package at all (npm only ships `examples/jsm`, never
   `examples/fonts`; that folder only exists in the full GitHub repo). This
   would have failed on **anyone's** machine, regardless of bundler. Fixed
   by vendoring the real font file locally at
   `src/fonts/helvetiker_regular.typeface.json` (downloaded directly from
   the three.js repo, all 208 glyphs verified, MIT-licensed) and importing
   it from there instead.
9. **`characterState.js`, `equipmentState.js`, `equipmentSheet.js`,
   `equipment.css`, `items.json`** — these were missing from the initial
   upload; you've since provided the real versions and they're now in
   place. (My first pass at this had invented placeholder versions of
   these — those are gone now, replaced with your actual files.)
10. **`index.html`** — I don't have your original, so I wrote a minimal one
    containing every element ID the JS actually looks up (`canvas`,
    `characterPage`, `equipmentPage`, `nodeName`, `nodeDesc`, `nodeCost`,
    `perkPoints`). **If you have your own hand-built version, use that
    instead** — just make sure it has the same IDs and a
    `<script type="module" src="/src/main.js">` tag.

## What YOU still need to add

**Asset files** — you mentioned having these backed up separately; drop
them straight into `public/` (which already has `nodes.json`):

- `sun.jpg`
- `cloud.png`
- `grass.jpg`
- `Telescope.glb`

Until these are in place, the build will still succeed (Vite doesn't
validate that referenced runtime assets exist), but the 3D scene will be
missing textures/the telescope model, showing 404s in the browser console.

## Two harmless orphaned files, FYI

`src/app.js` and `src/lensflare.js` import `react`, `@react-three/fiber`,
and `maath` — none of which are installed, and neither file is imported by
`main.js`. Vite only bundles what's actually reachable from your entry
point, so these sit there unused without breaking anything. Delete them if
you don't plan to use them, or `npm install` those packages first if you do.

## Setup steps

1. Copy this whole folder over your project (or merge file-by-file).
2. Drop the four asset files into `public/`.
3. Install dependencies:
   ```
   npm install
   ```
4. Run locally:
   ```
   npm run dev
   ```
   Open the printed URL (usually `http://localhost:5173`).
5. Before deploying, sanity-check the actual production build (this is
   what catches "works in dev, breaks on Pages" issues, since it uses the
   real `base` path):
   ```
   npm run build
   npm run preview
   ```
6. **Change `vite.config.js`'s `base` value** to your real GitHub repo
   name before deploying.
7. Ready for a GitHub Actions deploy workflow whenever you want it — say
   the word and I'll set that up next.
