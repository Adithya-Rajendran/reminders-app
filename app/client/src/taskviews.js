// Pure, view-specific selectors over the shared task list (see taskstore.js).
// Kept free of any React/browser/api imports so the framework-free node tests
// can cover the filtering/bucketing logic directly.
import { ZERO_DATE, isRealDate } from './tasklib.js'

export { isRealDate, ZERO_DATE }

// Soonest reminder instant for a task (Infinity = none), used to order Reminders.
export function nextRemind(t) {
  const times = (t.reminders || []).map((r) => new Date(r.reminder).getTime()).filter((n) => !isNaN(n))
  return times.length ? Math.min(...times) : Infinity
}
export const hasGroup = (t, g) => (t.labels || []).some((l) => (l.title || '') === g)
// First label's title — the (possibly uncoupled) group a reminder is tagged with.
export const labelGroup = (t) => (t.labels && t.labels[0] && t.labels[0].title) || ''

// Reminders view: open tasks carrying at least one reminder, optionally limited
// to a single group, soonest reminder first. Returns a fresh array (never mutates
// the shared store list).
export function selectReminders(tasks, group) {
  let list = tasks.filter((t) => !t.done && (t.reminders || []).length > 0)
  if (group) list = list.filter((t) => hasGroup(t, group))
  return list.sort((a, b) => nextRemind(a) - nextRemind(b))
}

// Upcoming view: open, real-dated tasks (the day-bucketing is done in the widget).
export function selectUpcoming(tasks) {
  return tasks.filter((t) => !t.done && isRealDate(t.due_date))
}

// Cues view: open tasks carrying an implementation-intention cue ("when X -> do Y").
export const hasCue = (t) => !!(t && typeof t.cue === 'string' && t.cue.trim())
export function selectCued(tasks) {
  return tasks.filter((t) => !t.done && hasCue(t))
}

// Habits view: open recurring tasks (RRULE-backed or custom-from-completion).
// Their completion history lives in X-REMINDERS-HABIT-LOG (see habitstats.js).
export const isRecurringTask = (t) => (Number(t.repeat_after) > 0) || t.repeat_mode === 1 || t.repeat_mode === 2
export function selectHabits(tasks) {
  return tasks.filter((t) => !t.done && isRecurringTask(t))
}

// Two-minute quick wins: keyed off an existing label convention (a "2min" tag,
// also matching "2 min" / "2-min"). A filter/badge, not new persistence.
export const QUICK_WIN_LABEL = '2min'
const normLabel = (s) => String(s || '').toLowerCase().replace(/[\s-]/g, '')
export const isTwoMinName = (name) => normLabel(name) === QUICK_WIN_LABEL
export const isQuickWin = (t) => (t.labels || []).some((l) => isTwoMinName(l.title || l))
export function selectQuickWins(tasks) {
  return tasks.filter((t) => !t.done && isQuickWin(t))
}

// ---- Today's frog + Eisenhower (pure views over priority × due-proximity) ----
const dueMs = (t) => (isRealDate(t.due_date) ? new Date(t.due_date).getTime() : Infinity)

// The one task to start with: highest PRIORITY, then nearest DUE. Goals and done
// tasks are excluded. Returns null when nothing is open.
export function selectFrog(tasks) {
  const open = (tasks || []).filter((t) => !t.done && !t.is_goal)
  if (!open.length) return null
  return open.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0) || dueMs(a) - dueMs(b))[0]
}

const URGENT_MS = 48 * 3600e3 // "urgent" = due within 48h (or already overdue)
// Eisenhower quadrant from importance (PRIORITY ≥ 3) × urgency (due-proximity).
export function eisenhowerQuadrant(task, now = new Date()) {
  const important = (task.priority || 0) >= 3
  const urgent = isRealDate(task.due_date) && (new Date(task.due_date).getTime() - (+now)) <= URGENT_MS
  return { q: important ? (urgent ? 'Q1' : 'Q2') : (urgent ? 'Q3' : 'Q4'), important, urgent }
}
export function groupEisenhower(tasks, now = new Date()) {
  const g = { Q1: [], Q2: [], Q3: [], Q4: [] }
  for (const t of (tasks || [])) {
    if (t.done || t.is_goal) continue
    g[eisenhowerQuadrant(t, now).q].push(t)
  }
  return g
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
// Relative day bucket for the Upcoming list.
export function dueBucket(due) {
  const diff = Math.round((startOfDay(new Date(due)) - startOfDay(new Date())) / 864e5)
  if (diff < 0) return { k: 'overdue', label: 'Overdue' }
  if (diff === 0) return { k: 'today', label: 'Today' }
  if (diff === 1) return { k: 'tomorrow', label: 'Tomorrow' }
  if (diff < 7) return { k: 'week', label: 'This week' }
  return { k: 'later', label: 'Later' }
}
export const UPCOMING_ORDER = ['overdue', 'today', 'tomorrow', 'week', 'later']
