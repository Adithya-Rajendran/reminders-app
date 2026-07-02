// Shared helpers for the widget specs: read the provisioned state, seed a
// deterministic dashboard layout via the API (so a spec shows exactly the widget
// under test, full-size), seed/clear tasks, and locate a widget frame by title.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
// dashlayout.js is pure ESM (no JSX) — safe to import into the node test runner.
import { COLS, GRID_V } from '../../app/client/src/dashlayout.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const STATE = JSON.parse(fs.readFileSync(path.join(HERE, '.state', 'e2e.json'), 'utf8'))
export const ZERO_DATE = '0001-01-01T00:00:00Z'

// Build a layout that stacks the given widgets full-width, tall enough that all
// of a widget's controls are on-screen (no react-grid-layout clipping).
const BIG = { w: 30, h: 26 }
export function buildLayout(specs) {
  const widgets = specs.map((s, i) => ({ i: s.i || `w-${s.type}-${i}`, type: s.type, ...(s.group ? { group: s.group } : {}) }))
  const layouts = {}
  for (const bp of Object.keys(COLS)) {
    let y = 0
    layouts[bp] = widgets.map((w) => { const it = { i: w.i, x: 0, y, w: Math.min(BIG.w, COLS[bp]), h: BIG.h }; y += BIG.h; return it })
  }
  return { version: 1, gridV: GRID_V, widgets, layouts }
}

export async function seedLayout(request, specs, dashId = 'main') {
  const r = await request.put(`/api/layouts/${dashId}`, { data: { layout: buildLayout(specs) } })
  expect(r.ok(), `seedLayout -> ${r.status()}`).toBeTruthy()
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

// ---- notes API helpers ----
export async function listNotes(request) {
  const r = await request.get('/api/notes'); expect(r.ok()).toBeTruthy(); return r.json()
}
export async function clearNotes(request) {
  const { notes = [] } = await listNotes(request)
  for (const n of notes) await request.delete(`/api/notes/item?path=${encodeURIComponent(n.path)}`)
}

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
