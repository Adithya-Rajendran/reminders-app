import { tk } from './api.js'

export const ZERO_DATE = '0001-01-01T00:00:00Z'
export const isRealDate = (d) => !!d && d !== ZERO_DATE && !isNaN(new Date(d).getTime())

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const atTime = (d, h = 9, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString() }
const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---- natural-language date parse (Vikunja Quick-Add-Magic subset) ----
function parseDate(text) {
  const t = text.toLowerCase()
  const now = new Date()
  let m
  if ((m = t.match(/\btoday\b/))) return { date: atTime(now), matched: m[0] }
  if ((m = t.match(/\btonight\b/))) return { date: atTime(now, 20), matched: m[0] }
  if ((m = t.match(/\btomorrow\b/))) { const d = new Date(now); d.setDate(d.getDate() + 1); return { date: atTime(d), matched: m[0] } }
  if ((m = t.match(/\b(this\s+)?weekend\b/))) { const d = new Date(now); const add = (6 - d.getDay() + 7) % 7 || 6; d.setDate(d.getDate() + add); return { date: atTime(d), matched: m[0] } }
  if ((m = t.match(/\bnext week\b/))) { const d = new Date(now); d.setDate(d.getDate() + (8 - d.getDay())); return { date: atTime(d), matched: m[0] } }
  if ((m = t.match(/\bin (\d+) days?\b/))) { const d = new Date(now); d.setDate(d.getDate() + Number(m[1])); return { date: atTime(d), matched: m[0] } }
  if ((m = t.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    const target = DOW.indexOf(m[1]); const d = new Date(now)
    let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7
    d.setDate(d.getDate() + add); return { date: atTime(d), matched: m[0] }
  }
  return { date: null, matched: null }
}

const PRI_RE = /(^|\s)!([1-5])\b/
const LABEL_RE = /(^|\s)\*([\w-]+)/g
// Classify a free-text cue into a typed implementation-intention trigger so it can
// be filtered by kind (e.g. the Focus widget matching time cues to "now"). "after"
// is the safe default (habit-stacking). Order matters: an explicit "after …" wins,
// then place-like phrases, then clock/time-of-day phrases.
const TIME_CUE_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b|\b(morning|noon|midday|afternoon|evening|tonight)\b/i
const LOC_CUE_RE = /\b(when i (arrive|leave|get (to|home))|at (the )?(home|office|work|desk|gym|store|school|kitchen|car))\b/i
export function cueTriggerOf(cue) {
  const v = String(cue || '').trim()
  if (!v) return null
  if (/^after\b/i.test(v)) return { kind: 'after', value: v }
  if (LOC_CUE_RE.test(v)) return { kind: 'location', value: v }
  if (TIME_CUE_RE.test(v)) return { kind: 'time', value: v }
  return { kind: 'after', value: v }
}
// Implementation-intention cue: "after morning erg -> draft figure". The text
// left of the first arrow (-> or →) is the trigger; the task (with its own
// date/priority/label tokens) is on the right.
const ARROW_RE = /\s*(?:->|→)\s*/

// Clock time in a quick-add line: "3pm", "3:30 pm", "at 9", "14:00", "noon",
// "morning". Returns { h, m, matched } or null. ("tonight" is intentionally left
// to parseDate — it's a date word that also implies 8pm.) Bare "at N" maps 1-6 to
// PM so "at 3" reads as 3 PM; 7-12 stay AM/noon.
const NAMED_TIME = { noon: [12, 0], midday: [12, 0], midnight: [0, 0], morning: [9, 0], afternoon: [14, 0], evening: [18, 0] }
const TIME_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b|\bat\s+(\d{1,2})\b|\b(noon|midday|midnight|morning|afternoon|evening)\b/i
function parseTime(text) {
  const m = text.match(TIME_RE)
  if (!m) return null
  if (m[7]) { const [h, mm] = NAMED_TIME[m[7].toLowerCase()]; return { h, m: mm, matched: m[0] } }
  if (m[3]) { let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'pm') h += 12; return { h, m: m[2] ? Number(m[2]) : 0, matched: m[0] } }
  if (m[4] !== undefined) { const h = Number(m[4]), mm = Number(m[5]); return h > 23 || mm > 59 ? null : { h, m: mm, matched: m[0] } }
  if (m[6] !== undefined) { let h = Number(m[6]); if (h >= 1 && h <= 6) h += 12; return h > 23 ? null : { h, m: 0, matched: m[0] } }
  return null
}

// Parse "after erg -> Submit report tomorrow !2 *finance" -> structured fields.
export function parseQuickAdd(input) {
  let cue
  let body = String(input == null ? '' : input)
  const am = body.match(ARROW_RE)
  if (am) {
    const left = body.slice(0, am.index).trim()
    if (left) { cue = left; body = body.slice(am.index + am[0].length) }
  }
  let title = ' ' + body + ' '
  let priority = 0
  const labels = []
  const pm = title.match(PRI_RE)
  if (pm) { priority = Number(pm[2]); title = title.replace(PRI_RE, ' ') }
  let lm
  while ((lm = LABEL_RE.exec(title)) !== null) labels.push(lm[2])
  title = title.replace(LABEL_RE, ' ')
  const { date, matched } = parseDate(title)
  if (matched) title = title.replace(new RegExp('\\b' + matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), ' ')
  // A clock time ("2pm", "at 9", "14:00") sets the time-of-day on the parsed date
  // (or today, if only a time was given) instead of the 9am default, and is
  // stripped from the title like the date word.
  let due = date
  const tm = parseTime(title)
  if (tm) {
    const base = isRealDate(date) ? new Date(date) : new Date()
    base.setHours(tm.h, tm.m, 0, 0)
    due = base.toISOString()
    title = title.replace(new RegExp(tm.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  }
  title = title.replace(/\s+/g, ' ').trim()
  return { title, priority, due_date: due || undefined, labels, ...(cue ? { cue, cue_trigger: cueTriggerOf(cue) } : {}) }
}

// ---- due chip label + urgency class ----
export function dueChip(d) {
  if (!isRealDate(d)) return null
  const dt = new Date(d)
  const diff = Math.round((startOfDay(dt) - startOfDay(new Date())) / 864e5)
  let label
  if (diff < 0) label = diff === -1 ? 'Yesterday' : `${Math.abs(diff)}d ago`
  else if (diff === 0) label = 'Today'
  else if (diff === 1) label = 'Tomorrow'
  else if (diff < 7) label = DOW_SHORT[dt.getDay()]
  else label = `${MON[dt.getMonth()]} ${dt.getDate()}`
  return { label, cls: diff < 0 ? 'overdue' : diff <= 1 ? 'due-soon' : '' }
}

// Full absolute date (+ time when set), e.g. "Mon, Jun 22, 2026, 3:00 PM" — shown
// as a tooltip on the relative chips so the exact date is always recoverable
// (accessibility; matches GitHub Primer's relative-time guidance). '' when no date.
export function absDate(d) {
  if (!isRealDate(d)) return ''
  const dt = new Date(d)
  const date = `${DOW_SHORT[dt.getDay()]}, ${MON[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`
  const t = timeLabel(d)
  return t ? `${date}, ${t}` : date
}

// Short local time label, e.g. "3:00 PM" (blank for all-day / midnight defaults).
export function timeLabel(d) {
  if (!isRealDate(d)) return ''
  const dt = new Date(d)
  const rawH = dt.getHours()
  const m = dt.getMinutes()
  if (rawH === 0 && m === 0) return '' // midnight = all-day / no meaningful time
  const ap = rawH < 12 ? 'AM' : 'PM'
  const h = rawH % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// True when a due date carries a meaningful time-of-day (not midnight / all-day).
// Lets the Calendar place dated-only tasks in the all-day lane and timed tasks on
// the grid, and drag-to-a-slot then writes a real time back (time-blocking).
export function isTimedDue(d) {
  if (!isRealDate(d)) return false
  const dt = new Date(d)
  return dt.getHours() !== 0 || dt.getMinutes() !== 0
}

export const PRIORITIES = [
  { v: 0, label: 'None', cls: 'p0' },
  { v: 1, label: 'Low', cls: 'p3' },
  { v: 2, label: 'Medium', cls: 'p3' },
  { v: 3, label: 'High', cls: 'p2' },
  { v: 4, label: 'Urgent', cls: 'p1' },
  { v: 5, label: 'DO NOW', cls: 'p1' },
]
export const pdotClass = (p) => (p >= 4 ? 'p1' : p === 3 ? 'p2' : p >= 1 ? 'p3' : 'p4')

// ---- mutations ----
export const updateTask = (id, patch) => tk('/tasks/' + id, { method: 'POST', body: JSON.stringify(patch) })
export const createTask = (projectId, body) => tk('/projects/' + projectId + '/tasks', { method: 'PUT', body: JSON.stringify(body) })
export const deleteTask = (id) => tk('/tasks/' + id, { method: 'DELETE' })

// Resolve-or-create labels by title, then attach to a task (best effort).
export async function attachLabels(taskId, names) {
  if (!names?.length) return
  let all = []
  try { all = await tk('/labels') } catch { all = [] }
  all = Array.isArray(all) ? all : []
  for (const name of names) {
    let lab = all.find((l) => (l.title || '').toLowerCase() === name.toLowerCase())
    if (!lab) { try { lab = await tk('/labels', { method: 'PUT', body: JSON.stringify({ title: name }) }) } catch { continue } }
    if (lab?.id) { try { await tk('/tasks/' + taskId + '/labels', { method: 'PUT', body: JSON.stringify({ label_id: lab.id }) }) } catch { /* ignore */ } }
  }
}
