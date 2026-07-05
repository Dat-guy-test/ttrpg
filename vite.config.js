import { defineConfig } from 'vite';

// GitHub Pages serves project sites from https://<you>.github.io/<repo-name>/,
// so every asset URL in the built site needs that repo name as a prefix
// — that's what `base` does. This MUST exactly match your current repo
// name (case-sensitive), or the browser will request assets at the wrong
// path, get GitHub Pages' 404 HTML page back instead of the real file,
// and refuse to run it (that's the "disallowed MIME type" error).
//
// Repo: https://dat-guy-test.github.io/ttrpg/  →  base: '/ttrpg/'
export default defineConfig(({ command }) => ({
    base: command === 'build' ? '/ttrpg/' : '/',
}));
