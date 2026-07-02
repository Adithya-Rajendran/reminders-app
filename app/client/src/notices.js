// Notice bus for the notes stack (mirrors notesbus.js): the editor components
// (NoteEditor/NoteRichEditor, src-root) emit user-facing failure notices; the
// NotesWidget subscribes and shows them in its NoticeBar slot. Pure module.
//   notice = { kind?: 'undo'|'error'|'info', label, action?: { label, fn } }

const handlers = new Set()
export function onNotice(fn) { handlers.add(fn); return () => handlers.delete(fn) }
export function emitNotice(notice) {
  for (const fn of handlers) { try { fn(notice) } catch { /* a dead subscriber must not break the emitter */ } }
}
