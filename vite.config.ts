import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The side panel bundles the opening book (CLS-4), about 700 kB.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        sidepanel: 'src/sidepanel/index.html',
        background: 'src/background.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
