// One-off screenshot capture for the Wave 3 theme-preset review — adapted
// straight from capture.mjs's pattern (same SHOTS state file, same
// addInitScript pre-paint trick, same waitSettled), but shooting one
// viewport x {classic, instrument, aurora} x {dark, light} instead of the
// full viewport x theme x board matrix capture.mjs covers. Deliberately NOT
// added to run.sh — this is a throwaway coordinator-review script, run by
// hand once via `node capture-presets.mjs` inside the same Playwright image
// run.sh uses, after `run.sh --step presets --board showcase --keep-up` has
// already seeded a showcase board and left the shots-* backends/BFF up.
//
// localStorage['reminders-accent'] is deliberately left UNSET (unlike
// capture.mjs, which pins it to 'copper' for gate stability) — the point
// here is to also exercise host/palettes.js's accent-reset design: with no
// stored accent, main.jsx should resolve each preset's own defaultAccent
// (indigo / indigo-flat / indigo), not fall through to the global
// DEFAULT_ACCENT (copper). If that wiring regressed, these screenshots would
// show copper bleeding into a preset built around indigo.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = JSON.parse(fs.readFileSync(path.join(HERE, '.state', 'shots.json'), 'utf8'))
const BASE = `http://${SHOTS.ip}:8080`
const USER = SHOTS.user

const OUT = path.join(HERE, 'output', 'presets-preview')
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORT = { width: 1512, height: 982 }
const PRESETS = ['classic', 'instrument', 'aurora']
const THEMES = ['dark', 'light']

async function waitSettled(page) {
  await page.locator('.app').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.topbar .wordmark').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.widget').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  await page.locator('.skeleton').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    for (const preset of PRESETS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          extraHTTPHeaders: { 'x-dev-user': USER },
        })
        // Same localStorage keys main.jsx reads pre-paint (host/theme.js's
        // 'reminders-theme', host/palettes.js's 'reminders-palette') — no
        // 'reminders-accent' key at all, so the preset's own defaultAccent
        // fallback is what's actually under test.
        await context.addInitScript(({ theme, preset }) => {
          localStorage.setItem('reminders-theme', theme)
          localStorage.setItem('reminders-palette', preset)
        }, { theme, preset })
        const page = await context.newPage()
        await page.goto(BASE + '/')
        await waitSettled(page)
        const file = path.join(OUT, `${preset}-${theme}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log(`  wrote ${path.relative(HERE, file)}`)
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}

await main()
