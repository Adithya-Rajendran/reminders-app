import { useCallback, useMemo, useState } from 'react'
import { useTaskList, selectUpcoming, dueBucket, UPCOMING_ORDER, isQuickWin, useWidgetSize, atMostW, atMostH, TaskRow, SkeletonRows, EmptyState, ErrorState, UndoBar, IconClock, IconBolt } from '../widget-sdk'

export default function UpcomingWidget() {
  // Derive from the shared task store (one /api/tasks fetch for the whole board).
  const selector = useCallback((all) => selectUpcoming(all), [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(selector)
  const [quickOnly, setQuickOnly] = useState(false)
  const sz = useWidgetSize()

  // Small: drop the bucket headers (they cost a row each) and the filter chip,
  // and show one flat soonest-first stream; when it's also very short, preview the
  // first few with a "+N more" footer. Roomier: full grouped view with the filter.
  const compact = atMostW(sz, 'sm') || atMostH(sz, 'xs')
  const capped = atMostH(sz, 'xs')

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

  const flatItems = capped ? shown.slice(0, 5) : shown
  const moreCount = shown.length - flatItems.length

  return (
    <div className="tasklist">
      {state === 'ready' && !compact && (tasks.length > 0 || quickOnly) && (
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
        : compact
          ? (
            <>
              <div className="task-stream">
                {flatItems.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
                ))}
              </div>
              {moreCount > 0 && <div className="up-more" style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 13 }}>+{moreCount} more</div>}
            </>
          )
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
