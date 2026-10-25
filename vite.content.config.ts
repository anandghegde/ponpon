import { defineConfig } from 'vite';

// Content scripts are classic scripts and can't import chunks, so this one is built on its own as a single IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/content/content.ts', formats: ['iife'], name: 'ponponContent', fileName: () => 'content.js' },
  },
});
