import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  clearScreen: false,
  server: {
    // browser development mode: the backend bridge is proxied so there is no CORS surface
    proxy: {
      '/__aps': { target: 'http://127.0.0.1:5174', changeOrigin: true, rewrite: (p) => p.replace(/^\/__aps/, '') },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    target: 'chrome130',
  },
  worker: { format: 'es' },
});
