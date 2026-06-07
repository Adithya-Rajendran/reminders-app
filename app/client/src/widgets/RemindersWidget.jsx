import React, { useCallback } from 'react'
import { tk } from '../api.js'
import { useTaskList } from '../useTasks.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconBell } from '../icons.jsx'

// Earliest reminder time on a task (ms since epoch), or Infinity if none.
function nextRemind(t) {
  const times = (t.reminders || []).map((r) => new Date(r.reminder).getTime()).filter((n) => !isNaN(n))
  return times.length ? Math.min(...times) : Infinity
}

// Your reminders — the open tasks that have a reminder set, soonest first. Each
// row is a normal task (complete with Undo, reschedule/clear via the Schedule
// picker, delete). A row pulses when its reminder fires live over SSE.
export default function RemindersWidget({ events }) {
  const loader = useCallback(async () => {
    const all = await tk('/tasks?per_page=200')
    return (Array.isArray(all) ? all : [])
      .filter((t) => !t.done && (t.reminders || []).length > 0)
      .sort((a, b) => nextRemind(a) - nextRemind(b))
  }, [])

  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(loader)

  // Task ids whose reminder/overdue alert fired recently — for a live "now" pulse.
  const fired = new Set()
  ;(events || []).forEach((e) => {
    const ev = e?.data?.event
    const t = ev?.data?.task
    if (t && /reminder|overdue/i.test(ev?.event_name || '')) fired.add(t.id)
  })

  return (
    <div className="tasklist">
      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && <ErrorState onRetry={load} />}
      {state === 'ready' && (tasks.length === 0
        ? <EmptyState icon={IconBell} title="No reminders set" sub="Open any task’s Schedule chip, pick a time, and keep “Remind me” on — it’ll show up here." />
        : <div className="task-stream">
            {tasks.map((t) => (
              <div key={t.id} className={fired.has(t.id) ? 'reminding' : ''}>
                <TaskRow task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
              </div>
            ))}
          </div>)}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
