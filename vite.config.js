import { defineConfig } from 'vite';

// Static SPA build. Base is relative so the built site works when opened
// from any subdirectory (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
