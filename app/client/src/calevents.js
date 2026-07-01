// The calendar widget's task overlay: map the shared task store's tasks onto
// FullCalendar event objects. Pure (no React/DOM) so the node tests exercise
// the skip rules (done / dateless / ZERO_DATE) and the all-day-vs-timed
// classification without a renderer.
import { ZERO_DATE, isTimedDue } from './tasklib.js'

export function tasksToCalendarEvents(tasks) {
  const out = []
  for (const t of (Array.isArray(tasks) ? tasks : [])) {
    // (Single source: /api/tasks IS the CalDAV store, so no separate VTODO feed.)
    // Date-only tasks go in the all-day lane (not the timed grid, which would
    // clutter it); a task with a real time shows on the grid. Dragging a date
    // task onto a time slot sets a real time -> persisted as a time-block.
    if (t.done || !t.due_date || t.due_date === ZERO_DATE) continue
    out.push({
      id: 'task-' + t.id, title: t.title, start: t.due_date, allDay: !isTimedDue(t.due_date), editable: true,
      classNames: ['cal-task', 'cal-task-local'],
      extendedProps: { kind: 'task', source: 'local', taskId: t.id, done: !!t.done },
    })
  }
  return out
}
