import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ARTIFACT_DIR, PRIMARY_VIEWPORTS, RESIZE_WIDGETS,
  gotoApp, seedLayout, widget, resetE2EState,
  createTask, seedNote, taskProjectId, ymd,
} from '../lib.mjs'

const DASH = 'main'
const SHOT_DIR = path.join(ARTIFACT_DIR, 'resize-shots')
const RESULTS_FILE = path.join(ARTIFACT_DIR, 'resize-results.json')

const todayAt = (h) => {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

async function seedResizeData(request) {
  const pid = await taskProjectId(request)
  const focus = await createTask(request, pid, {
    title: 'Finalize widget visual QA notes',
    due_date: todayAt(10),
    reminders: [{ reminder: todayAt(10) }],
    important: true,
    priority: 3,
    clarified: true,
    cue: 'after opening the dashboard',
  })
  await createTask(request, pid, {
    title: 'Review compact widget screenshots',
    due_date: todayAt(15),
    reminders: [{ reminder: todayAt(15) }],
    important: true,
    priority: 2,
    clarified: true,
    cue: 'after CI uploads artifacts',
  })
  await createTask(request, pid, {
    title: 'Raw capture: compare 5k2k spacing with MBP spacing',
  })
  await createTask(request, pid, {
    title: 'Ship resize follow-up changelog',
    due_date: todayAt(16),
    priority: 1,
    clarified: true,
  })
  await seedNote(request, 'Pinned resize note', 'This pinned note stays readable in compact, tall, wide, and max widget shapes.', { pinned: true })
  const plan = await request.put('/api/daily-plan', { data: { date: ymd(), ids: [focus.id] } })
  expect(plan.ok(), `seed daily plan -> ${plan.status()}`).toBeTruthy()
}

async function expectPrimary(frame, type) {
  switch (type) {
    case 'overview':
      await expect(frame.getByLabel(/capture a task to the inbox/i)).toBeVisible()
      break
    case 'inbox':
      await expect(frame.getByRole('button', { name: /^Clarify$/i })).toBeVisible()
      break
    case 'reminders':
      await expect(frame.getByLabel('Add a reminder')).toBeVisible()
      break
    case 'upcoming':
      await expect(frame.getByText('Finalize widget visual QA notes')).toBeVisible()
      break
    case 'calendar':
      await expect(frame.locator('.cal-mini, .fc').first()).toBeVisible()
      break
    case 'notes':
      await expect(frame.getByLabel(/Search notes/i)).toBeVisible()
      break
    case 'notepin':
      await expect(frame.getByText('Pinned resize note')).toBeVisible()
      break
    case 'review':
      await expect(frame.locator('.rv-big')).toBeVisible()
      break
    case 'cues':
      await expect(frame.locator('.flow-compact-list, .flow-canvas').first()).toBeVisible()
      break
    case 'triage':
      await expect(frame.locator('.tri-focus, .eq').first()).toBeVisible()
      break
    case 'daily':
      await expect(frame.getByLabel('Add a task to today')).toBeVisible()
      break
    case 'focus':
      await expect(frame.getByRole('button', { name: /start focus/i })).toBeVisible()
      break
    default:
      throw new Error(`No primary assertion for widget type ${type}`)
  }
}

async function auditWidget(page, frame, widgetType, widgetLabel) {
  return page.evaluate(({ label, type }) => {
    const root = document.querySelector(`.widget[aria-label="${label}"]`)
    const body = root?.querySelector('.widget-body')
    const head = root?.querySelector('.widget-head')
    const rectOf = (el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const intersects = (a, b) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom
    const issues = []
    const warnings = []
    if (!root || !body || !head) return { ok: false, issues: ['widget frame missing'], warnings, metrics: {} }

    const wr = rectOf(root)
    const br = rectOf(body)
    const hr = rectOf(head)
    const bodyOverflowX = body.scrollWidth - body.clientWidth
    if (bodyOverflowX > 3 && !body.querySelector('.flow-canvas')) issues.push(`body horizontal overflow ${bodyOverflowX}px`)

    const controls = [...root.querySelectorAll('button,input,textarea,select,[role="button"],[role="checkbox"]')].filter(visible)
    for (const el of controls) {
      const r = rectOf(el)
      const clip = el.closest('.widget-head') ? hr : br
      if (!intersects(r, clip)) continue
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim().slice(0, 48) || el.tagName.toLowerCase()
      if (r.left < clip.left - 2 || r.right > clip.right + 2) issues.push(`control clipped horizontally: ${name}`)
      if (r.top < clip.top - 2 || r.bottom > clip.bottom + 2) {
        const msg = `control clipped vertically: ${name}`
        if (el.closest('.widget-head')) issues.push(msg)
        else warnings.push(msg)
      }
    }

    const leaked = [...body.querySelectorAll('*')]
      .filter((el) => visible(el) && !el.closest('.flow-content'))
      .slice(0, 600)
      .find((el) => {
        const r = rectOf(el)
        return intersects(r, br) && (r.right > br.right + 4 || r.left < br.left - 4)
      })
    if (leaked) {
      const cls = leaked.className && typeof leaked.className === 'string'
        ? `.${leaked.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`
        : leaked.tagName.toLowerCase()
      issues.push(`content leaks horizontally: ${cls}`)
    }

    const textLen = (body.innerText || '').trim().length
    if (textLen < 8 && !['calendar'].includes(type)) warnings.push('body text very sparse')
    if (br.height < 24) issues.push('body collapsed below usable height')
    return {
      ok: issues.length === 0,
      issues,
      warnings,
      metrics: {
        widget: wr,
        body: br,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        textLen,
        visibleControls: controls.length,
      },
    }
  }, { label: widgetLabel, type: widgetType })
}

async function contactSheet(page, viewport, rows) {
  const cells = await Promise.all(rows.map(async (r) => {
    const b64 = await fs.readFile(r.screenshot, 'base64')
    const cls = r.ok ? (r.warnings.length ? 'warn' : '') : 'fail'
    const msg = r.ok ? 'OK' : r.issues.join('<br>')
    const warn = r.warnings.length ? '<br>Warn: ' + r.warnings.slice(0, 2).join('<br>') : ''
    return `<div class="cell ${cls}"><div class="label">${r.widget} · ${r.scenario}</div><img src="data:image/png;base64,${b64}"><div class="msg">${msg}${warn}</div></div>`
  }))
  await page.setViewportSize({ width: 1800, height: 1600 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{font:12px system-ui;margin:16px;background:#f6f7f8;color:#111}
    h1{font-size:18px;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
    .cell{background:white;border:1px solid #d7dbe0;border-radius:6px;padding:8px;break-inside:avoid}.fail{border-color:#d73a49;box-shadow:0 0 0 2px #d73a4930}.warn{border-color:#d29922}
    .label{font-weight:700;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    img{display:block;width:100%;height:180px;object-fit:contain;background:#fff;border:1px solid #edf0f2}.msg{margin-top:5px;color:#57606a;line-height:1.3}
  </style><h1>${viewport.label} ${viewport.width}x${viewport.height}</h1><div class="grid">${cells.join('')}</div>`, { waitUntil: 'load' })
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 30_000 })
  const out = path.join(ARTIFACT_DIR, `contact-${viewport.name}.png`)
  await page.screenshot({ path: out, fullPage: true })
  return out
}

async function appendResults(viewport, rows, contact) {
  let current = { results: [], contacts: [] }
  try { current = JSON.parse(await fs.readFile(RESULTS_FILE, 'utf8')) } catch { /* first viewport */ }
  current.results = current.results.filter((r) => r.viewport !== viewport.name).concat(rows)
  current.contacts = current.contacts.filter((p) => !p.endsWith(`contact-${viewport.name}.png`)).concat(contact)
  await fs.writeFile(RESULTS_FILE, JSON.stringify(current, null, 2))
}

test.beforeAll(async () => {
  await fs.rm(ARTIFACT_DIR, { recursive: true, force: true })
  await fs.mkdir(SHOT_DIR, { recursive: true })
})

test.beforeEach(async ({ request }) => {
  await resetE2EState(request)
  await seedResizeData(request)
})

for (const viewport of PRIMARY_VIEWPORTS) {
  test(`@resize every widget keeps polished resize states on ${viewport.label}`, async ({ page, request }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const rows = []

    for (const w of RESIZE_WIDGETS) {
      for (const scenario of w.scenarios) {
        const scenarioName = `${scenario.name}-${scenario.size.w}x${scenario.size.h}`
        await seedLayout(request, [{ type: w.type, w: scenario.size.w, h: scenario.size.h }], DASH)
        await gotoApp(page)
        const frame = widget(page, w.label)
        await expect(frame).toBeVisible()
        await expectPrimary(frame, w.type)

        const screenshot = path.join(SHOT_DIR, viewport.name, w.type, `${scenarioName}.png`)
        await fs.mkdir(path.dirname(screenshot), { recursive: true })
        await frame.screenshot({ path: screenshot })
        const audit = await auditWidget(page, frame, w.type, w.label)
        const row = {
          viewport: viewport.name,
          viewportSize: `${viewport.width}x${viewport.height}`,
          type: w.type,
          widget: w.label,
          scenario: scenarioName,
          ok: audit.ok,
          issues: audit.issues,
          warnings: audit.warnings,
          metrics: audit.metrics,
          screenshot,
        }
        rows.push(row)
        expect(row.issues, `${viewport.name} ${w.type} ${scenarioName}`).toEqual([])
      }
    }

    const contact = await contactSheet(page, viewport, rows)
    await appendResults(viewport, rows, contact)
  })
}
