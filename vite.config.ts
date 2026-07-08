import { defineConfig } from 'vite';

// Relative base so the built site works whether it is served from the domain
// root (custom domain / user-site) or from a project sub-path
// (yousifelia.github.io/portfolio/). Revisit if client-side routing is added.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0, // keep the .glb / poster as real files, not data URIs
  },
});
