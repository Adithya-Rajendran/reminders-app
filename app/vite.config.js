import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React SPA lives in ./client and is built into ./public, which the
// Express BFF (server/index.js) serves as static files on the same origin.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  // @excalidraw/excalidraw's entry branches on process.env.IS_PREACT, which is
  // undefined in the browser — define it so the bundle doesn't reference `process`.
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
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
