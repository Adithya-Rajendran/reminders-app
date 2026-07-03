// Projects & Areas — the app-owned organizing dimension (v2). A "project" is a
// finite outcome ("Launch v2"); an "area" an ongoing responsibility ("Health", or
// a freelancer's client). A task belongs to at most one, referenced by id on the
// VTODO via X-REMINDERS-AREA (portable, device-syncing) — so only the registry
// (names/colors/kind) lives in SQLite; task membership never does. Pure-ish (no
// Express) so integrations and the route handlers share one implementation and it
// is node-tested directly, mirroring server/daily_plan.js.
import crypto from 'node:crypto'
import { listAreas, insertArea, updateAreaRow, deleteAreaRow } from './config.js'
import { err } from './util.js'

const KINDS = new Set(['project', 'area'])
const STATUSES = new Set(['active', 'archived'])
const MAX_NAME = 120

const cleanName = (v) => { const s = String(v || '').trim(); if (!s) throw err('name is required', 400); return s.slice(0, MAX_NAME) }
const cleanKind = (v) => (KINDS.has(v) ? v : 'project')
const cleanStatus = (v) => (STATUSES.has(v) ? v : 'active')
const cleanColor = (v) => String(v || '').trim().slice(0, 32)

// DB row (snake_case) -> wire shape (camelCase).
const toWire = (r) => r && ({ id: r.id, name: r.name, kind: r.kind, color: r.color, status: r.status, sort: r.sort, created: r.created_at })

export async function list(userId) {
  return (await listAreas(userId)).map(toWire)
}

export async function create(userId, body) {
  const b = body || {}
  const existing = await listAreas(userId)
  const sort = Number.isFinite(Number(b.sort)) ? Number(b.sort) : existing.length
  const row = await insertArea({
    id: 'area-' + crypto.randomUUID(), user_id: userId,
    name: cleanName(b.name), kind: cleanKind(b.kind), color: cleanColor(b.color), status: 'active', sort,
  })
  return toWire(row)
}

export async function update(userId, id, body) {
  const b = body || {}
  const patch = {}
  if ('name' in b) patch.name = cleanName(b.name)
  if ('kind' in b) patch.kind = cleanKind(b.kind)
  if ('color' in b) patch.color = cleanColor(b.color)
  if ('status' in b) patch.status = cleanStatus(b.status)
  if ('sort' in b) patch.sort = Number(b.sort) || 0
  const row = await updateAreaRow(userId, id, patch)
  if (!row) throw err('area not found', 404)
  return toWire(row)
}

// Deleting an area leaves any member task's X-REMINDERS-AREA pointing at a gone
// id — which the client reads as "no area" (it filters by the known registry), so
// tasks are never orphaned or lost. Archiving (status) is the softer alternative.
export async function remove(userId, id) {
  if (!(await deleteAreaRow(userId, id))) throw err('area not found', 404)
  return { ok: true }
}
