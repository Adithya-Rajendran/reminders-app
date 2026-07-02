// The daily plan — the small set of task ids the user picked for "today"
// (Daily Plan widget; read by Focus). Moved server-side from browser
// localStorage so it syncs across browsers and is readable by integrations.
// Only the day's SELECTION lives here (ids into the CalDAV task store); the
// tasks themselves never do. Pure-ish module (no Express) so integrations and
// the route handlers share one implementation, node-tested directly.
import { getDailyPlanIds, setDailyPlanIds } from './config.js'
import { err } from './util.js'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Server-local calendar day — a DEFAULT for callers that don't know the user's
// timezone (integrations); the SPA always sends its own local date.
export const todayYmd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// A plan is a human-picked shortlist — the caps are sanity bounds, not limits a
// legitimate client ever hits.
const MAX_IDS = 100
const MAX_ID_LEN = 512

export function cleanDate(date) {
  const v = String(date || '')
  if (!DATE_RE.test(v)) throw err('date must be YYYY-MM-DD', 400)
  return v
}

// Validate + dedupe (first occurrence wins, preserving the user's order).
export function cleanIds(ids) {
  if (!Array.isArray(ids)) throw err('ids must be an array', 400)
  const seen = new Set()
  const out = []
  for (const raw of ids) {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_ID_LEN) throw err('invalid task id', 400)
    if (seen.has(raw)) continue
    if (out.length >= MAX_IDS) throw err(`too many ids (max ${MAX_IDS})`, 400)
    seen.add(raw)
    out.push(raw)
  }
  return out
}

export async function getPlan(userId, date) {
  const d = cleanDate(date)
  return { date: d, ids: await getDailyPlanIds(userId, d) }
}

export async function setPlan(userId, date, ids) {
  const d = cleanDate(date)
  const clean = cleanIds(ids)
  await setDailyPlanIds(userId, d, clean)
  return { date: d, ids: clean }
}

// Idempotent add/remove for integrations (the SPA sends whole plans).
export async function addToPlan(userId, date, taskId) {
  const d = cleanDate(date)
  const ids = await getDailyPlanIds(userId, d)
  return setPlan(userId, d, ids.includes(taskId) ? ids : [...ids, taskId])
}

export async function removeFromPlan(userId, date, taskId) {
  const d = cleanDate(date)
  const ids = (await getDailyPlanIds(userId, d)).filter((x) => x !== taskId)
  await setDailyPlanIds(userId, d, ids)
  return { date: d, ids }
}
