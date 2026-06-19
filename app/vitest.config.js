import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component-test harness (jsdom + Testing Library), run via `npm run test:component`.
// Deliberately standalone — it does NOT extend vite.config.js (whose root is
// `client/`); here the root is the package dir so the `test/` suite and `client/src`
// share one relative space. Component tests are `*.test.jsx` so the framework-free
// node runner (test/run.mjs, which globs `*.test.mjs`) never picks them up.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.jsx', 'client/src/**/*.test.jsx'],
  },
})
