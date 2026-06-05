import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React SPA lives in ./client and is built into ./public, which the
// Express BFF (server/index.js) serves as static files on the same origin.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    // Local-dev convenience: `npm run dev` proxies API calls to the BFF.
    proxy: {
      '/api': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
})
