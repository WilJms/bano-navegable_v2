import { defineConfig } from 'vite';

// base relativa: el sitio funciona bajo https://<usuario>.github.io/<cualquier-repo>/
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
