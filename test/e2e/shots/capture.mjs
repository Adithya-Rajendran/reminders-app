// Screenshot capture: for one seeded board, shoot every {viewport x theme}
// combination as a full-page PNG plus a per-widget crop, printing a
// diagnostic (measured container width -> resolved grid tier -> column
// count) for each page load — this is what turns the 2560/5120 "one tier
// short" bug (see the plan doc) into a console assertion instead of an
// eyeball check.
//
// Runs inside mcr.microsoft.com/playwright:v<derived>-noble (see run.sh):
// playwright-core + PLAYWRIGHT_BROWSERS_PATH=/ms-playwright come from that
// image; this script's own node_modules (installed into shots/) only needs
// to supply the `playwright-core` JS package version-matched to it. The repo
// is separately mounted read-only at /repo so BREAKPOINTS/COLS/WIDGET_MANIFEST
// can be imported directly from the app's own pure modules — the diagnostic
// must reflect the REAL grid math, not a hand-copied constant that can drift.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { BREAKPOINTS, COLS } from '/repo/app/client/src/dashlayout.js'
import { WIDGET_MANIFEST } from '/repo/app/client/src/widgets/manifest.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = JSON.parse(fs.readFileSync(path.join(HERE, '.state', 'shots.json'), 'utf8'))
const BASE = `http://${SHOTS.ip}:8080`
const USER = SHOTS.user

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : fallback
}
const STEP = arg('step')
const BOARD = arg('board')
if (!STEP || !BOARD) { console.error('usage: capture.mjs --step <name> --board <showcase|empty|no-widgets>'); process.exit(1) }
const EXPECTED_WIDGETS = BOARD === 'no-widgets' ? 0 : WIDGET_MANIFEST.length

const OUT = path.join(HERE, 'output', STEP, BOARD)
const OUT_WIDGETS = path.join(OUT, 'widgets')
fs.mkdirSync(OUT_WIDGETS, { recursive: true })

const VIEWPORTS = [
  { w: 1512, h: 982 },
  { w: 2560, h: 1440 },
  { w: 5120, h: 2160 },
]
const THEMES = ['dark', 'light']

// Mirrors react-grid-layout's own breakpoint selection: the largest
// breakpoint whose px value is <= the measured container width.
function tierFor(px) {
  const entries = Object.entries(BREAKPOINTS).sort((a, b) => b[1] - a[1])
  for (const [tier, val] of entries) if (px >= val) return tier
  return entries[entries.length - 1][0]
}

// Each widget frame carries role="group" aria-label={title} (Dashboard.jsx),
// and an un-grouped widget's title IS its manifest label — an exact-attribute
// match, so 'Note' (notepin) can never resolve to the 'Notes' widget and a
// label that appears as body text inside another widget (e.g. 'Inbox' in
// Overview's capture row) can't grab the wrong frame the way a text filter
// could on the wider board. Same locator the e2e resize spec uses.
const widgetFrame = (page, label) => page.locator(`.widget[aria-label="${label}"]`)

async function waitSettled(page) {
  await page.locator('.app').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.topbar .wordmark').waitFor({ state: 'visible', timeout: 20000 })
  if (EXPECTED_WIDGETS > 0) {
    await page.locator('.widget').nth(EXPECTED_WIDGETS - 1).waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  }
  // No skeleton left anywhere on the page (SkeletonRows use `.skeleton`).
  await page.locator('.skeleton').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  // The wide tiers are DERIVED on load (fillBreakpoints) and react-grid-layout
  // compacts asynchronously, so at 2560/5120 the page height can keep changing
  // after widgets are visible — a fixed sleep raced this and produced
  // dimension-mismatched full-page shots between otherwise-identical runs.
  // Wait until page + grid heights are stable for 4 consecutive 150ms samples.
  await page.waitForFunction(() => {
    const h = document.body.scrollHeight + ':' + (document.querySelector('.layout')?.offsetHeight || 0)
    const s = (window.__settle = window.__settle || { last: '', n: 0 })
    if (s.last === h) s.n += 1
    else { s.last = h; s.n = 0 }
    return s.n >= 4
  }, { timeout: 20000, polling: 150 }).catch(() => console.warn('  (settle: height never stabilized — shooting anyway)'))
  // FullCalendar / the Cues canvas / hover-out transitions settle a beat later.
  await page.waitForTimeout(500)
}

// Diagnostic: measured container width -> expected tier (from the app's own
// BREAKPOINTS) -> expected cols, plus a cheap actual-column estimate derived
// from the Reminders widget's real rendered pixel width (its grid `w` is
// looked up from the current saved layout, keyed by the resolved tier).
//
// react-grid-layout's WidthProvider measures its OWN rendered root node —
// the `.layout` div (see Dashboard.jsx's `<Grid className="layout">`), which
// sits INSIDE `.grid-wrap`'s padded content box (`.grid-wrap { padding: 8px
// 24px 40px; box-sizing: border-box }` — 48px horizontal, styles.css:498) —
// NOT `.grid-wrap` itself, whose clientWidth (border-box, padding included)
// is just the full available width. Measuring the wrong element here would
// hide exactly the "one tier short" bug this diagnostic exists to catch.
async function diagnostic(page, label) {
  // `.layout` only exists when there's at least one widget (react-grid-layout
  // renders nothing on the empty "add a widget" board) — fall back to
  // `.grid-wrap` there so the no-widgets board still gets a (less precise)
  // measurement rather than none at all.
  const hasLayout = (await page.locator('.layout').count()) > 0
  const target = hasLayout ? '.layout' : '.grid-wrap'
  const measured = await page.locator(target).first().evaluate((el) => el.getBoundingClientRect().width).catch(() => null)
  if (measured == null) { console.log(`  ${label}: no .grid-wrap on this board`); return }
  const tier = tierFor(measured)
  let actualCols = null
  if (EXPECTED_WIDGETS > 0) {
    try {
      const res = await fetch(`${BASE}/api/layouts/main`, { headers: { 'x-dev-user': USER } })
      const { layout } = await res.json()
      const item = (layout?.layouts?.[tier] || []).find((it) => it.i === 'w-reminders')
      if (item) {
        const box = await widgetFrame(page, 'Reminders').locator('xpath=..').boundingBox()
        if (box && box.width > 0) actualCols = Math.round((measured / box.width) * item.w)
      }
    } catch { /* best-effort only */ }
  }
  console.log(`  ${label} measured=${measured}px tier=${tier} cols=${COLS[tier]}${actualCols != null ? ` actualCols≈${actualCols}` : ''}`)
}

// One crop per manifest type. No per-type special cases anymore: the old
// gamified Triage widget kept its Eisenhower matrix behind a 'Matrix' tab
// (which needed an extra click + crop); the de-gamified Prioritize widget
// (type 'triage' — the persisted type never renames) renders the matrix
// inline below its "Most important" callout, so the plain frame crop already
// shows it.
async function shootWidgets(page, viewport, theme) {
  for (const { type, label } of WIDGET_MANIFEST) {
    const frame = widgetFrame(page, label)
    if (await frame.count() === 0) continue
    await frame.first().screenshot({ path: path.join(OUT_WIDGETS, `${viewport}-${theme}-${type}.png`) }).catch((e) => console.warn(`  (skip ${type} crop: ${e.message})`))
  }
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const viewportLabel = `${vp.w}x${vp.h}`
        const label = `viewport=${viewportLabel}`
        const context = await browser.newContext({
          viewport: { width: vp.w, height: vp.h },
          deviceScaleFactor: 1,
          extraHTTPHeaders: { 'x-dev-user': USER },
        })
        // Pre-paint theme/accent init, same localStorage keys main.jsx reads
        // before first render (see app/client/src/main.jsx). Pinned (not left
        // to DEFAULT_ACCENT) so a stored accent never varies the gates —
        // 'copper' matches the app's current default (host/accents.js).
        await context.addInitScript(({ theme, accent }) => {
          localStorage.setItem('reminders-theme', theme)
          localStorage.setItem('reminders-accent', accent)
        }, { theme, accent: 'copper' })
        const page = await context.newPage()
        await page.goto(BASE + '/')
        await waitSettled(page)
        await diagnostic(page, label)

        const fileBase = `${viewportLabel}-${theme}`
        await page.screenshot({ path: path.join(OUT, `${fileBase}.png`), fullPage: true })
        if (EXPECTED_WIDGETS > 0) await shootWidgets(page, viewportLabel, theme)

        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
  console.log(`  wrote screenshots to ${path.relative(HERE, OUT)}`)
}

await main()
