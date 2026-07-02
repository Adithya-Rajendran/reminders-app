// The calendar widget's task overlay mapping (client/src/calevents.js): which
// tasks appear on the calendar and in which lane. Pure — no renderer needed.
// Run with: node test/calevents.test.mjs
import { tasksToCalendarEvents } from '../client/src/calevents.js'
import { ZERO_DATE } from '../client/src/tasklib.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const t = (over = {}) => ({ id: 7, title: 'water plants', done: false, due_date: '2026-07-02T00:00:00.000Z', ...over })

// --- skip rules ---
ok(tasksToCalendarEvents([t({ done: true })]).length === 0, 'a completed task is not shown')
ok(tasksToCalendarEvents([t({ due_date: null })]).length === 0, 'a dateless task is not shown')
ok(tasksToCalendarEvents([t({ due_date: ZERO_DATE })]).length === 0, 'the ZERO_DATE sentinel is not shown')
ok(tasksToCalendarEvents(null).length === 0 && tasksToCalendarEvents(undefined).length === 0, 'null/undefined input -> empty (no throw)')

// --- shape ---
{
  const [e] = tasksToCalendarEvents([t()])
  ok(e.id === 'task-7' && e.title === 'water plants' && e.start === '2026-07-02T00:00:00.000Z', 'id/title/start map through')
  ok(e.editable === true, 'tasks are draggable (drag = reschedule)')
  ok(e.classNames.includes('cal-task') && e.classNames.includes('cal-task-local'), 'styled as a local task chip')
  ok(e.extendedProps.kind === 'task' && e.extendedProps.source === 'local' && e.extendedProps.taskId === 7, 'extendedProps identify the task for drag/click handlers')
}

// --- all-day vs timed lane (local-time midnight = date-only -> all-day lane) ---
{
  // Pinned, transition-free local date (mid-July): constructing "today" would
  // break in zones whose DST spring-forward skips midnight on the run day.
  const midnightLocal = new Date(2026, 6, 15)
  const [dateOnly] = tasksToCalendarEvents([t({ due_date: midnightLocal.toISOString() })])
  ok(dateOnly.allDay === true, 'a date-only (local midnight) task goes to the all-day lane')
  const nineThirty = new Date(2026, 6, 15, 9, 30)
  const [timed] = tasksToCalendarEvents([t({ due_date: nineThirty.toISOString() })])
  ok(timed.allDay === false, 'a task with a real time shows on the timed grid')
}

// --- multiple tasks keep order; only eligible ones survive ---
{
  const out = tasksToCalendarEvents([t({ id: 1 }), t({ id: 2, done: true }), t({ id: 3 })])
  ok(out.length === 2 && out[0].id === 'task-1' && out[1].id === 'task-3', 'ineligible tasks are filtered, order preserved')
}

console.log(`calevents: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
