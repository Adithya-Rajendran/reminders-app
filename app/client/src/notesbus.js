// Cross-component signal to open a note by path from anywhere outside the notes
// widget — the command palette, a [[wikilink]] click, or a backlink row. The
// NotesWidget subscribes via onOpenNote() and brings the note up in its editor
// pane (reloading its list first so freshly-created notes appear). Mirrors
// tasksbus.js.
const listeners = new Set()

export function onOpenNote(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitOpenNote(path) {
  for (const fn of listeners) {
    try { fn(path) } catch { /* a dead listener must not break the others */ }
  }
}
