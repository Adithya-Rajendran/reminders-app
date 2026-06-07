import React, { useCallback } from 'react'
import { tk } from '../api.js'
import { useTaskList } from '../useTasks.js'
import { isRealDate } from '../tasklib.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconClock } from '../icons.jsx'

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function groupOf(due) {
  const diff = Math.round((startOfDay(new Date(due)) - startOfDay(new Date())) / 864e5)
  if (diff < 0) return { k: 'overdue', label: 'Overdue' }
  if (diff === 0) return { k: 'today', label: 'Today' }
  if (diff === 1) return { k: 'tomorrow', label: 'Tomorrow' }
  if (diff < 7) return { k: 'week', label: 'This week' }
  return { k: 'later', label: 'Later' }
}
const ORDER = ['overdue', 'today', 'tomorrow', 'week', 'later']

export default function UpcomingWidget() {
  const loader = useCallback(async () => {
    const all = await tk('/tasks?sort_by=due_date&order_by=asc&per_page=100')
    return (Array.isArray(all) ? all : []).filter((t) => !t.done && isRealDate(t.due_date))
  }, [])

  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(loader)

  const groups = {}
  for (const t of tasks) {
    const g = groupOf(t.due_date)
    ;(groups[g.k] ||= { label: g.label, items: [] }).items.push(t)
  }

  return (
    <div className="tasklist">
      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && <ErrorState onRetry={load} />}
      {state === 'ready' && (tasks.length === 0
        ? <EmptyState icon={IconClock} title="Nothing upcoming" sub="Scheduled tasks appear here, grouped by when they’re due." />
        : ORDER.filter((k) => groups[k]).map((k) => (
            <div key={k}>
              <div className="group-head">
                <span className="g-title">{groups[k].label}</span>
                <span className="g-count">{groups[k].items.length}</span>
              </div>
              <div className="task-stream">
                {groups[k].items.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
                ))}
              </div>
            </div>
          )))}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
