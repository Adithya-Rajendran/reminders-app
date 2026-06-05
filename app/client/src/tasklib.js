import { vk } from './api.js'

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

// Parse "Submit report tomorrow !2 *finance" -> structured fields.
export function parseQuickAdd(input) {
  let title = ' ' + input + ' '
  let priority = 0
  const labels = []
  const pm = title.match(PRI_RE)
  if (pm) { priority = Number(pm[2]); title = title.replace(PRI_RE, ' ') }
  let lm
  while ((lm = LABEL_RE.exec(title)) !== null) labels.push(lm[2])
  title = title.replace(LABEL_RE, ' ')
  const { date, matched } = parseDate(title)
  if (matched) title = title.replace(new RegExp('\\b' + matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), ' ')
  title = title.replace(/\s+/g, ' ').trim()
  return { title, priority, due_date: date || undefined, labels }
}

// ---- scheduler presets (used by the due-chip popover) ----
export function schedulePreset(key) {
  const now = new Date()
  switch (key) {
    case 'today': return atTime(now)
    case 'tomorrow': { const d = new Date(now); d.setDate(d.getDate() + 1); return atTime(d) }
    case 'weekend': { const d = new Date(now); const add = (6 - d.getDay() + 7) % 7 || 6; d.setDate(d.getDate() + add); return atTime(d) }
    case 'nextweek': { const d = new Date(now); d.setDate(d.getDate() + (8 - d.getDay())); return atTime(d) }
    case 'clear': return ZERO_DATE
    default: return null
  }
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
export const updateTask = (id, patch) => vk('/tasks/' + id, { method: 'POST', body: JSON.stringify(patch) })
export const createTask = (projectId, body) => vk('/projects/' + projectId + '/tasks', { method: 'PUT', body: JSON.stringify(body) })
export const deleteTask = (id) => vk('/tasks/' + id, { method: 'DELETE' })

// Resolve-or-create labels by title, then attach to a task (best effort).
export async function attachLabels(taskId, names) {
  if (!names?.length) return
  let all = []
  try { all = await vk('/labels') } catch { all = [] }
  all = Array.isArray(all) ? all : []
  for (const name of names) {
    let lab = all.find((l) => (l.title || '').toLowerCase() === name.toLowerCase())
    if (!lab) { try { lab = await vk('/labels', { method: 'PUT', body: JSON.stringify({ title: name }) }) } catch { continue } }
    if (lab?.id) { try { await vk('/tasks/' + taskId + '/labels', { method: 'PUT', body: JSON.stringify({ label_id: lab.id }) }) } catch { /* ignore */ } }
  }
}
