// Shared helpers for the widget specs: read the provisioned state, seed a
// deterministic dashboard layout via the API (so a spec shows exactly the widget
// under test, full-size), seed/clear tasks, and locate a widget frame by title.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
// dashlayout.js is pure ESM (no JSX) — safe to import into the node test runner.
import { COLS, GRID_V, DEFAULT_SIZE } from '../../app/client/src/dashlayout.js'
import { WIDGET_MANIFEST } from '../../app/client/src/widgets/manifest.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const stateFile = path.join(HERE, '.state', 'e2e.json')
export const STATE = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  : {
      user: process.env.E2E_USER || process.env.DEV_VISUAL_USER || 'e2e-user',
      taskProjectId: process.env.E2E_TASK_PROJECT_ID ? Number(process.env.E2E_TASK_PROJECT_ID) : null,
      eventList: process.env.E2E_EVENT_ACCOUNT_ID && process.env.E2E_EVENT_LIST_URL
        ? { accountId: process.env.E2E_EVENT_ACCOUNT_ID, listUrl: process.env.E2E_EVENT_LIST_URL }
        : null,
    }
export const ZERO_DATE = '0001-01-01T00:00:00Z'
export const ARTIFACT_DIR = path.join(HERE, '.artifacts')

// Build a layout that stacks the given widgets full-width, tall enough that all
// of a widget's controls are on-screen (no react-grid-layout clipping).
const BIG = { w: 30, h: 26 }
export function buildLayout(specs) {
  const widgets = specs.map((s, i) => ({ i: s.i || `w-${s.type}-${i}`, type: s.type, ...(s.group ? { group: s.group } : {}) }))
  const layouts = {}
  for (const bp of Object.keys(COLS)) {
    let y = 0
    layouts[bp] = widgets.map((w, i) => {
      const spec = specs[i] || {}
      const h = Math.max(1, spec.h || spec.size?.h || BIG.h)
      const desiredW = spec.w || spec.size?.w || BIG.w
      const itemW = Math.max(1, Math.min(desiredW, COLS[bp]))
      const it = {
        i: w.i,
        x: Math.max(0, Math.min(spec.x || 0, COLS[bp] - itemW)),
        y,
        w: itemW,
        h,
      }
      y += h
      return it
    })
  }
  return { version: 1, gridV: GRID_V, widgets, layouts }
}

export async function seedLayout(request, specs, dashId = 'main') {
  const r = await request.put(`/api/layouts/${dashId}`, { data: { layout: buildLayout(specs) } })
  expect(r.ok(), `seedLayout -> ${r.status()}`).toBeTruthy()
}

export async function resetDashboards(request) {
  const r = await request.put('/api/dashboards', { data: { dashboards: [{ id: 'main', name: 'Dashboard' }] } })
  expect(r.ok(), `resetDashboards -> ${r.status()}`).toBeTruthy()
  await seedLayout(request, [], 'main')
}

export async function taskProjectId(request) {
  if (STATE.taskProjectId) return STATE.taskProjectId
  const r = await request.get('/api/projects')
  expect(r.ok(), `GET /api/projects -> ${r.status()}`).toBeTruthy()
  const projects = await r.json()
  const project = projects.find((p) => /tasks/i.test(p.title || '')) || projects[0]
  expect(project?.id, 'task project id').toBeTruthy()
  return project.id
}

// ---- task API helpers (carry the dev-user header via the request fixture) ----
export async function listTasks(request) {
  const r = await request.get('/api/tasks?per_page=250')
  expect(r.ok(), `listTasks -> ${r.status()}`).toBeTruthy()
  return r.json()
}
export async function createTask(request, projectId, body) {
  const r = await request.put(`/api/projects/${projectId}/tasks`, { data: body })
  expect(r.ok(), `createTask -> ${r.status()} ${await r.text().catch(() => '')}`).toBeTruthy()
  return r.json()
}
export async function patchTask(request, id, body) {
  const r = await request.post(`/api/tasks/${encodeURIComponent(id)}`, { data: body })
  expect(r.ok(), `patchTask -> ${r.status()}`).toBeTruthy()
  return r.json()
}
export async function deleteTask(request, id) {
  const r = await request.delete(`/api/tasks/${encodeURIComponent(id)}`)
  expect(r.ok(), `deleteTask -> ${r.status()}`).toBeTruthy()
}
// Clean slate: remove every task so a spec's seeded set is deterministic.
export async function clearTasks(request) {
  for (const t of await listTasks(request)) await deleteTask(request, t.id)
}

const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export async function clearDailyPlan(request, date = ymd()) {
  const r = await request.put('/api/daily-plan', { data: { date, ids: [] } })
  expect(r.ok(), `clearDailyPlan -> ${r.status()}`).toBeTruthy()
}

export async function clearEvents(request, from = isoDaysFromNow(-40), to = isoDaysFromNow(40)) {
  const r = await request.get(`/api/calendar/events?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`)
  expect(r.ok(), `GET /api/calendar/events -> ${r.status()}`).toBeTruthy()
  const { events = [] } = await r.json()
  for (const e of events) {
    const del = await request.delete('/api/calendar/events', { data: { accountId: e.accountId, objectUrl: e.objectUrl } })
    expect(del.ok(), `DELETE /api/calendar/events -> ${del.status()}`).toBeTruthy()
  }
}

// ---- notes API helpers ----
export async function listNotes(request) {
  const r = await request.get('/api/notes'); expect(r.ok()).toBeTruthy(); return r.json()
}
export async function clearNotes(request) {
  const { notes = [] } = await listNotes(request)
  for (const n of notes) await request.delete(`/api/notes/item?path=${encodeURIComponent(n.path)}`)
}
export async function seedNote(request, title, body, { pinned = false } = {}) {
  const c = await request.post('/api/notes', { data: { folder: '', title } })
  expect(c.ok(), `create note -> ${c.status()}`).toBeTruthy()
  const { path } = await c.json()
  const r = await request.put('/api/notes/item', { data: { path, body } })
  expect(r.ok(), `save note -> ${r.status()}`).toBeTruthy()
  if (pinned) {
    const p = await request.post('/api/notes/pin', { data: { path, pinned: true } })
    expect(p.ok(), `pin note -> ${p.status()}`).toBeTruthy()
  }
  return path
}

export async function resetE2EState(request) {
  await resetDashboards(request)
  await clearTasks(request)
  await clearDailyPlan(request)
  await clearEvents(request)
  await clearNotes(request)
}

// ---- resize audit helpers ----
export const PRIMARY_VIEWPORTS = [
  { name: 'mbp14', label: 'MacBook Pro 14', width: 1512, height: 982 },
  { name: '5k2k', label: '5k2k monitor', width: 5120, height: 2160 },
]

function constraintsFor(widget) {
  return {
    min: widget.minSize || { w: 4, h: 4 },
    def: widget.defaultSize || DEFAULT_SIZE,
    max: widget.maxSize || { w: Math.max((widget.defaultSize || DEFAULT_SIZE).w + 8, 18), h: Math.max((widget.defaultSize || DEFAULT_SIZE).h + 8, 18) },
    aspect: widget.aspect || null,
  }
}

function fitSize(size, c) {
  let w = Math.max(c.min.w, Math.min(c.max.w, Math.round(size.w)))
  let h = Math.max(c.min.h, Math.min(c.max.h, Math.round(size.h)))
  if (c.aspect) {
    if (w / h > c.aspect.max) w = Math.max(c.min.w, Math.min(c.max.w, Math.floor(h * c.aspect.max)))
    if (w / h < c.aspect.min) h = Math.max(c.min.h, Math.min(c.max.h, Math.floor(w / c.aspect.min)))
  }
  return { w, h }
}

export function resizeScenarios(widget) {
  const c = constraintsFor(widget)
  const standard = fitSize(c.def, c)
  const wideW = Math.min(c.max.w, Math.max(standard.w + 6, c.min.w + 6))
  const wide = fitSize({ w: wideW, h: Math.max(c.min.h, standard.h) }, c)
  const tallH = Math.min(c.max.h, Math.max(standard.h + 6, c.min.h + 6))
  const tallW = c.aspect ? Math.max(c.min.w, Math.ceil(tallH * c.aspect.min)) : Math.max(c.min.w, Math.min(standard.w, c.min.w + 1))
  const tall = fitSize({ w: Math.min(c.max.w, tallW), h: tallH }, c)
  return [
    { name: 'min', size: fitSize(c.min, c) },
    { name: 'standard', size: standard },
    { name: 'wide', size: wide },
    { name: 'tall', size: tall },
    { name: 'max', size: fitSize(c.max, c) },
  ]
}

export const RESIZE_WIDGETS = WIDGET_MANIFEST.map((w) => ({ ...w, scenarios: resizeScenarios(w) }))

// ---- UI helpers ----
export async function gotoApp(page) {
  await page.goto('/')
  // The SPA reaches "ready" only after /api/me resolves (dev-user header).
  await expect(page.locator('.app')).toBeVisible()
  await expect(page.locator('.topbar .wordmark')).toHaveText('Reminders')
}

// A widget frame located by its header title (scoped so the topbar wordmark and
// other widgets don't match). Returns a Locator.
export function widget(page, title) {
  return page.locator('.widget').filter({ has: page.getByText(title, { exact: true }) })
}

// Wait for the shared task store to have rendered (no skeleton) inside a widget.
export async function waitWidgetReady(frame) {
  await expect(frame).toBeVisible()
  await expect(frame.locator('.skeleton, .sk-row').first()).toBeHidden({ timeout: 15000 }).catch(() => {})
}

export const isoIn = (mins) => new Date(Date.now() + mins * 60000).toISOString()
export const isoDaysFromNow = (days, h = 9) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString() }
export const isoDaysAgo = (days, h = 9) => isoDaysFromNow(-days, h)
