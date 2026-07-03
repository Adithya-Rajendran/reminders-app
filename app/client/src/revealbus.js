// Tiny "reveal a task" bus (mirrors boardbus.js / notesbus.js): the command palette
// (and anything else that can name a task by id) asks the app shell to scroll that
// task's row into view and flash it, so a task found by content search actually goes
// somewhere. Pure module — node-tested; the DOM scroll/flash handler is registered
// once by the app shell (App.jsx), which also owns the "not on this board" fallback.
const handlers = new Set()

export function onRevealTask(fn) { handlers.add(fn); return () => handlers.delete(fn) }

export function emitRevealTask(id) {
  const key = String(id)
  for (const fn of handlers) { try { fn(key) } catch { /* a dead handler must not break the caller */ } }
}
