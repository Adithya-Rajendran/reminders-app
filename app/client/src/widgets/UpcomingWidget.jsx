import { useCallback, useMemo } from 'react'
import { useTaskList } from '../useTasks.js'
import { selectUpcoming, dueBucket, UPCOMING_ORDER } from '../taskviews.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconClock } from '../icons.jsx'

export default function UpcomingWidget() {
  // Derive from the shared task store (one /api/tasks fetch for the whole board).
  const selector = useCallback((all) => selectUpcoming(all), [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(selector)

  const groups = useMemo(() => {
    const g = {}
    for (const t of tasks) {
      const b = dueBucket(t.due_date)
      ;(g[b.k] ||= { label: b.label, items: [] }).items.push(t)
    }
    return g
  }, [tasks])

  return (
    <div className="tasklist">
      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && <ErrorState onRetry={load} />}
      {state === 'ready' && (tasks.length === 0
        ? <EmptyState icon={IconClock} title="Nothing upcoming" sub="Scheduled tasks appear here, grouped by when they’re due." />
        : UPCOMING_ORDER.filter((k) => groups[k]).map((k) => (
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
