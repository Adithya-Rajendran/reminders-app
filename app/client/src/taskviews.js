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
