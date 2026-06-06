// Recurrence — Vikunja-compatible. Evaluated on the CURRENT stored row when a
// task's `done` transitions false->true and it repeats. Instead of completing,
// the task stays open and its due date (and reminders) advance.
//
// repeat_mode enum (real Vikunja meaning):
//   0 = from due_date (add repeat_after seconds to the existing due date)
//   1 = monthly (same day-of-month next month, calendar arithmetic)
//   2 = from current time (add repeat_after seconds to "now"; the only mode that
//       can advance without an existing due date)

const isReal = (d) => d instanceof Date && !isNaN(d)
const addSeconds = (d, s) => new Date(d.getTime() + s * 1000)

// Go AddDate(0,1,0)-compatible: same day-of-month next month with overflow
// normalized (Jan 31 -> Mar 3), computed in UTC to avoid DST drift.
const addOneMonth = (d) => new Date(Date.UTC(
  d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(),
  d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
))

// old: { due_date: Date|null, repeat_after: number(seconds), repeat_mode: 0|1|2,
//        reminders: Date[] }
// returns: { advanced: boolean, due_date: Date|null, reminders: Date[] }
export function nextOccurrence(old, now = new Date()) {
  const interval = old.repeat_after || 0
  const oldDue = isReal(old.due_date) ? old.due_date : null
  const reminders = Array.isArray(old.reminders) ? old.reminders.filter(isReal) : []
  const mode = [0, 1, 2].includes(old.repeat_mode) ? old.repeat_mode : 0

  if (mode === 1) { // monthly
    if (!oldDue) return { advanced: false, due_date: null, reminders }
    return { advanced: true, due_date: addOneMonth(oldDue), reminders: reminders.map(addOneMonth) }
  }
  if (mode === 2) { // from current time — advances even without a due date
    const newDue = addSeconds(now, interval)
    const shiftMs = oldDue ? (newDue.getTime() - oldDue.getTime()) : interval * 1000
    return { advanced: true, due_date: newDue, reminders: reminders.map((r) => new Date(r.getTime() + shiftMs)) }
  }
  // mode 0 — needs an anchor
  if (!oldDue) return { advanced: false, due_date: null, reminders }
  return { advanced: true, due_date: addSeconds(oldDue, interval), reminders: reminders.map((r) => addSeconds(r, interval)) }
}

// Does a done:false->true transition trigger recurrence for this row?
export function isRecurring(t) {
  return (t.repeat_after || 0) > 0 || t.repeat_mode === 1
}
