// Shared helpers for seed-*.mjs. Mirrors test/e2e/lib.mjs's approach (plain
// fetch + the x-dev-user header, no browser) but targets the shots-bff
// container, and builds the "showcase" board from the app's OWN pure layout
// module (mounted read-only at /repo — see run.sh) instead of hand-rolling
// grid math here, so the seed never drifts from dashlayout.js's real
// behavior (repack, tier columns, GRID_V).
//
// Runs inside a plain node:22-bookworm-slim container: the shots/ directory
// itself is bind-mounted read-write (so .state/ + node_modules resolve
// normally, relative to this file) and the repo is separately bind-mounted
// read-only at /repo so the two pure app modules below can be imported
// directly (see run.sh) — no npm deps, no ABI concerns, never drifts from
// the app's real grid math.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLS, GRID_V, DEFAULT_SIZE, repack } from '/repo/app/client/src/dashlayout.js'
import { WIDGET_MANIFEST } from '/repo/app/client/src/widgets/manifest.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SHOTS = JSON.parse(fs.readFileSync(path.join(HERE, '.state', 'shots.json'), 'utf8'))
export const BASE = `http://${SHOTS.ip}:8080`
export const USER = SHOTS.user // 'shots-user'
const HDR = { 'x-dev-user': USER, 'content-type': 'application/json' }

export async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { ...HDR, ...(opts.headers || {}) } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${p} -> ${res.status}: ${text}`)
  return body
}

// ---- tasks ----
export const listTasks = () => api('/api/tasks?per_page=250')
export const createTask = (body) => api(`/api/projects/${SHOTS.taskProjectId}/tasks`, { method: 'PUT', body: JSON.stringify(body) })
export const patchTask = (id, body) => api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) })
export const deleteTask = (id) => api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
export async function clearTasks() {
  for (const t of await listTasks()) await deleteTask(t.id)
}

// ---- notes ----
export const listNotes = () => api('/api/notes')
export async function createNote(title, body, folder = '') {
  const { path } = await api('/api/notes', { method: 'POST', body: JSON.stringify({ folder, title }) })
  await api('/api/notes/item', { method: 'PUT', body: JSON.stringify({ path, body }) })
  return path
}
export async function clearNotes() {
  const { notes = [] } = await listNotes()
  for (const n of notes) await api(`/api/notes/item?path=${encodeURIComponent(n.path)}`, { method: 'DELETE' })
}

// ---- calendar events ----
export async function clearEvents() {
  const from = isoDaysFromNow(-40), to = isoDaysFromNow(40)
  const { events = [] } = await api(`/api/calendar/events?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`)
  for (const e of events) await api('/api/calendar/events', { method: 'DELETE', body: JSON.stringify({ accountId: e.accountId, objectUrl: e.objectUrl }) })
}
export const createEvent = (summary, start, end, allDay = false) =>
  api('/api/calendar/events', { method: 'POST', body: JSON.stringify({ accountId: SHOTS.eventList.accountId, listUrl: SHOTS.eventList.listUrl, summary, start, end, allDay }) })

// ---- layout ----
// Same sizeFor() Dashboard.jsx uses: DEFAULT_SIZE (10x9) overridden by the
// manifest's per-type defaultSize.
const sizeFor = (type) => {
  const m = WIDGET_MANIFEST.find((w) => w.type === type)
  return { ...DEFAULT_SIZE, ...(m?.defaultSize || {}) }
}
export const WIDGET_ID = (type) => `w-${type}`

// All 9 manifest widget types at their default sizes, shelf-packed at the lg
// tier — see docs/adding-a-widget.md + widgets/manifest.js for the catalog.
// Every other breakpoint is intentionally OMITTED: Dashboard.jsx derives them
// on load (fillBreakpoints), which this harness also uses to live-check that
// self-healing path (see capture.mjs's diagnostic print).
export function showcaseLayout() {
  const types = WIDGET_MANIFEST.map((m) => m.type)
  const raw = types.map((type) => ({ i: WIDGET_ID(type), type, x: 0, y: 0, ...sizeFor(type) }))
  const lg = repack(raw, COLS.lg)
  const widgets = lg.map((it) => ({ i: it.i, type: it.type }))
  const layouts = { lg: lg.map(({ type: _type, ...rest }) => rest) }
  return { version: 1, gridV: GRID_V, widgets, layouts }
}

export function emptyBoardLayout() {
  return { version: 1, gridV: GRID_V, widgets: [], layouts: { lg: [] } }
}

export const putLayout = (layout) => api('/api/layouts/main', { method: 'PUT', body: JSON.stringify({ layout }) })

// ---- dates ----
export const isoIn = (mins) => new Date(Date.now() + mins * 60000).toISOString()
export const isoDaysFromNow = (days, h = 9) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString() }
export const isoDaysAgo = (days, h = 9) => isoDaysFromNow(-days, h)
