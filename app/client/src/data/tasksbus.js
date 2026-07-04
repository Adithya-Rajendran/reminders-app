// A minimal cross-widget signal. When any widget mutates a task (complete,
// delete, reschedule, …) it calls emitTasksChanged(); every mounted task list
// subscribes via onTasksChanged() and reloads, so Inbox / Upcoming / Reminders
// never drift out of sync after an action taken in one of them.
const listeners = new Set()

export function onTasksChanged(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitTasksChanged() {
  for (const fn of listeners) {
    try { fn() } catch { /* a dead listener must not break the others */ }
  }
}
