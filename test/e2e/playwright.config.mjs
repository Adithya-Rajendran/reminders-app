import { defineConfig } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// baseURL = the BFF itself (same-origin SPA + /api), addressed via the private IP
// the backends were started on. The dev-bypass header authenticates every
// request (document + fetch/XHR) — the SPA never sends it on its own.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ipFile = path.join(HERE, '.state', 'ip')
const IP = fs.existsSync(ipFile) ? fs.readFileSync(ipFile, 'utf8').trim() : '127.0.0.1'

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
    // Video needs Playwright's bundled ffmpeg (CDN-blocked in this sandbox); the
    // trace already captures DOM snapshots, so video stays off. CI uses the
    // normal `playwright install` and can re-enable if desired.
    video: 'off',
    actionTimeout: 12_000,
    // PW_CHROME points at a manually-fetched Chrome-for-Testing when the
    // Playwright CDN isn't reachable (local sandbox). Unset in CI -> bundled
    // chromium. --no-sandbox because the harness can run as root.
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
