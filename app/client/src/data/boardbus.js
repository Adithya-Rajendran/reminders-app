// Tiny board bus (mirrors notesbus.js): lets the app shell know what widgets
// are on the current board (for palette "Go to <widget>" commands) and lets
// anyone scroll-and-flash a widget by instance id — or ADD a widget by type (the
// omnibox uses this so "Add Prioritize" works when the surface isn't on the board
// yet, closing the renamed-surface dead-end). Pure module — node-tested.

const goHandlers = new Set()
let board = [] // [{ i, title, type }]
const boardHandlers = new Set()
const addHandlers = new Set()

// ---- "go to widget" (scroll + flash) ----
export function onGoToWidget(fn) { goHandlers.add(fn); return () => goHandlers.delete(fn) }
export function flashWidget(id) { for (const fn of goHandlers) { try { fn(id) } catch { /* a dead handler must not break the caller */ } } }

// ---- "add widget by type" (Dashboard registers the real add + scroll/flash) ----
export function onAddWidget(fn) { addHandlers.add(fn); return () => addHandlers.delete(fn) }
export function emitAddWidget(type) { for (const fn of addHandlers) { try { fn(type) } catch { /* a dead handler must not break the caller */ } } }

// ---- current board contents (published by Dashboard) ----
export function publishBoard(widgets) {
  board = Array.isArray(widgets) ? widgets : []
  for (const fn of boardHandlers) { try { fn(board) } catch { /* ignore */ } }
}
export function onBoard(fn) { boardHandlers.add(fn); return () => boardHandlers.delete(fn) }
export function getBoard() { return board }
