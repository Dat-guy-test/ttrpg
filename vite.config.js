import { defineConfig } from 'vite';

// IMPORTANT: change 'ttrpg-system-website-test' below to your actual
// GitHub repo name (the part after github.com/<you>/ ). GitHub Pages
// serves project sites from https://<you>.github.io/<repo-name>/, so
// every asset URL in the built site needs that repo name as a prefix
// — that's what `base` does. Using `command` (rather than the old
// process.env.NODE_ENV check) is the reliable way to tell dev and
// build apart: Vite always passes 'serve' for `npm run dev` and
// 'build' for `npm run build`, regardless of how NODE_ENV happens to
// be set in your shell.
export default defineConfig(({ command }) => ({
    base: command === 'build' ? '/ttrpg-system-website-test/' : '/',
}));
