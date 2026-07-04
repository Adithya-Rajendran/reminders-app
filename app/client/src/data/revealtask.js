// The DOM side of "reveal a task": find the task's row (TaskRow stamps
// [data-task-id]), scroll it into view and flash it; if the task isn't a row on the
// current board, flash a task widget so the user still lands where their tasks live,
// and announce why nothing highlighted. Lifted out of App.jsx so the load-bearing
// DOM logic — and the id string-matching — is unit-testable against jsdom, and
// registered once via onRevealTask(revealTaskInDom).
import { getBoard, flashWidget } from './boardbus.js'
import { announce } from '../widget-sdk'

// Widget types that render task rows — the fallback flashes one of these when a
// searched task isn't found as a row on the current board.
export const TASK_WIDGET_TYPES = new Set([
  'reminders', 'upcoming', 'overview', 'inbox', 'triage', 'daily', 'focus', 'cues', 'calendar',
])

const FLASH_MS = 1500

// Returns a short outcome string ('revealed' | 'flashed' | 'announced' | 'nodom')
// so tests can assert which branch ran without racing the flash timeout.
export function revealTaskInDom(id, doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return 'nodom'
  // TaskRow renders data-task-id={task.id}; a numeric id becomes the string form in
  // the DOM, so match against the string-coerced id (emitRevealTask coerces too).
  const key = String(id)
  let el = null
  for (const node of doc.querySelectorAll('[data-task-id]')) {
    if (node.getAttribute('data-task-id') === key) { el = node; break }
  }
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('task-flash')
    setTimeout(() => { el.classList.remove('task-flash') }, FLASH_MS)
    return 'revealed'
  }
  const tw = getBoard().find((w) => TASK_WIDGET_TYPES.has(w.type))
  if (tw) {
    flashWidget(tw.i)
    announce('Opened your tasks — that one isn’t shown on this board.')
    return 'flashed'
  }
  announce('That task isn’t on this board — add a task widget to see it.')
  return 'announced'
}
