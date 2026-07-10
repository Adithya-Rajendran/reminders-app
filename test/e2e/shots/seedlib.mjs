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
//
// NOTE: app/client/src/dashlayout.js is now a compatibility shim re-exporting
// ./domain/dashlayout.js. The whole harness (this file + capture.mjs, same as
// test/e2e/lib.mjs) imports the shim path consistently; if the shim is ever
// removed, point both imports at /repo/app/client/src/domain/dashlayout.js.
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

// ---- daily plan ----
// Same shape test/e2e/lib.mjs uses: PUT { date: 'YYYY-MM-DD', ids } — an empty
// ids array IS the clear (there's no DELETE). Feeds the Daily Plan widget's
// picked-for-today list and Focus's plan-first ranking.
const pad2 = (n) => String(n).padStart(2, '0')
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const putDailyPlan = (ids, date = ymd()) => api('/api/daily-plan', { method: 'PUT', body: JSON.stringify({ date, ids }) })
export const clearDailyPlan = () => putDailyPlan([])

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

// EVERY manifest widget type at its default size, shelf-packed at the lg tier
// — built dynamically from WIDGET_MANIFEST (see docs/adding-a-widget.md +
// widgets/manifest.js for the catalog), so a widget added to the app shows up
// in the showcase with no harness change. Every other breakpoint is
// intentionally OMITTED: Dashboard.jsx derives them on load (fillBreakpoints,
// now clamped to each widget's manifest size contract), which this harness
// also uses to live-check that self-healing path (see capture.mjs's
// diagnostic print). The host's size contract (applyConstraints/clampAspect
// in domain/dashlayout.js) is render-time only and never rewrites x/y/w/h on
// load; every manifest defaultSize already sits inside its own aspect band,
// so the seeded lg tier round-trips unchanged.
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
