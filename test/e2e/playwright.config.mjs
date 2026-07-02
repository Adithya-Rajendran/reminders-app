import { defineConfig } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// baseURL = the BFF itself (same-origin SPA + /api), addressed via the private IP
// the backends were started on. The dev-bypass header authenticates every
// request (document + fetch/XHR) — the SPA never sends it on its own.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ipFile = path.join(HERE, '.state', 'ip')
// Fail fast rather than fall back to 127.0.0.1: the BFF's SSRF guard always
// blocks loopback for its outbound CalDAV fetches, so a loopback base URL only
// yields confusing downstream failures.
if (!fs.existsSync(ipFile)) {
  throw new Error('test/e2e/.state/ip not found — start the harness first: bash test/e2e/run.sh (or setup-backends.sh + start-bff.sh + provision.mjs).')
}
const IP = fs.readFileSync(ipFile, 'utf8').trim()

export default defineConfig({
  testDir: './specs',
  fullyParallel: false, // shared CalDAV/WebDAV state — keep specs serial
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://${IP}:8080`,
    extraHTTPHeaders: { 'x-dev-user': 'e2e-user' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video off — the retained traces already capture DOM snapshots per action.
    video: 'off',
    actionTimeout: 12_000,
    // PW_CHROME: optional pre-fetched Chrome path for environments without
    // Playwright-CDN access; unset in CI -> bundled chromium. --no-sandbox only
    // when actually running as root (Chromium refuses the sandbox there);
    // GitHub-hosted runners run as a normal user and keep the sandbox.
    launchOptions: {
      args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '--disable-dev-shm-usage'],
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
