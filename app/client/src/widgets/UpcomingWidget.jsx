import { useCallback, useMemo, useState } from 'react'
import { useTaskList } from '../useTasks.js'
import { selectUpcoming, dueBucket, UPCOMING_ORDER, isQuickWin } from '../taskviews.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconClock, IconBolt } from '../icons.jsx'

export default function UpcomingWidget() {
  // Derive from the shared task store (one /api/tasks fetch for the whole board).
  const selector = useCallback((all) => selectUpcoming(all), [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(selector)
  const [quickOnly, setQuickOnly] = useState(false)

  // A filter, not new persistence: optionally narrow the list to 2-minute wins.
  const shown = useMemo(() => (quickOnly ? tasks.filter(isQuickWin) : tasks), [tasks, quickOnly])
  const quickCount = useMemo(() => tasks.filter(isQuickWin).length, [tasks])

  const groups = useMemo(() => {
    const g = {}
    for (const t of shown) {
      const b = dueBucket(t.due_date)
      ;(g[b.k] ||= { label: b.label, items: [] }).items.push(t)
    }
    return g
  }, [shown])

  return (
    <div className="tasklist">
      {state === 'ready' && (tasks.length > 0 || quickOnly) && (
        <div className="up-filter">
          <button
            className={`chip qw-filter${quickOnly ? ' on' : ''}`}
            aria-pressed={quickOnly}
            title="Show only two-minute wins"
            onClick={() => setQuickOnly((v) => !v)}
          >
            <IconBolt size={12} /> 2-min only{quickCount ? ` · ${quickCount}` : ''}
          </button>
        </div>
      )}
      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && <ErrorState onRetry={load} />}
      {state === 'ready' && (shown.length === 0
        ? <EmptyState icon={IconClock} title={quickOnly ? 'No 2-minute wins' : 'Nothing upcoming'} sub={quickOnly ? 'Tag short tasks with a “2min” label to collect them here.' : 'Scheduled tasks appear here, grouped by when they’re due.'} />
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
