import { useCallback, useMemo, useState } from 'react'
import { useTaskList, selectUpcoming, dueBucket, byImportanceThenDue, UPCOMING_ORDER, isQuickWin, parseQuickAdd, widgetStore, useWidgetSize, atMostW, atMostH, TaskRow, SkeletonRows, EmptyState, ErrorState, UndoBar, QuickAddPreview, IconClock, IconBolt, IconPlus, IconChevR } from '../widget-sdk'

const COLLAPSE_KEY = 'upcoming-collapsed'
// Default a quick-added task to today at 9am so it lands in the "Today" bucket
// (an Upcoming task without a date wouldn't show here at all).
function todayDefault() {
  const d = new Date(); d.setHours(9, 0, 0, 0)
  if (d.getTime() < Date.now()) d.setHours(d.getHours() + 1, 0, 0, 0)
  return d.toISOString()
}

// Forward agenda of dated tasks, grouped by relative day with an always-visible
// Overdue group pinned on top. A glanceable forward window isn't just a lookup —
// browsing it passively triggers recall ("oh, I need to…"), the "opportunistic
// rehearsal" calendars are valued for. Within each day, importance leads so a
// trivial-but-sooner task can't bury an important one (the mere-urgency effect).
export default function UpcomingWidget({ tasks: tasksCap, projects, instanceId }) {
  const inboxId = projects?.[0]?.id
  const selector = useCallback((all) => selectUpcoming(all), [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, onSetCue, onPatch, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const [quickOnly, setQuickOnly] = useState(false)
  const [draft, setDraft] = useState('')
  const store = useMemo(() => widgetStore(instanceId), [instanceId])
  const [collapsed, setCollapsed] = useState(() => store.loadStringSet(COLLAPSE_KEY))
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
    for (const v of Object.values(g)) v.items.sort(byImportanceThenDue)
    return g
  }, [shown])

  const flatItems = useMemo(() => {
    const sorted = [...shown].sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    return capped ? sorted.slice(0, 5) : sorted
  }, [shown, capped])
  const moreCount = shown.length - flatItems.length

  const toggleGroup = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    store.saveStringSet(COLLAPSE_KEY, next)
    return next
  })

  const addTask = async (e) => {
    e.preventDefault()
    const raw = draft.trim()
    if (!raw || !inboxId) return
    setDraft('')
    const parsed = parseQuickAdd(raw)
    try {
      await tasksCap.create(inboxId, {
        title: parsed.title || raw,
        priority: parsed.priority || 0,
        due_date: parsed.due_date || todayDefault(),
        ...(parsed.labels?.length ? { labels: parsed.labels } : {}),
        ...(parsed.cue ? { cue: parsed.cue } : {}),
        ...(parsed.cue_trigger ? { cue_trigger: parsed.cue_trigger } : {}),
      })
      tasksCap.emitChanged(); load()
    } catch { setDraft(raw) }
  }

  const rows = (items) => (
    <div className="task-stream">
      {items.map((t) => (
        <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} onSetCue={onSetCue} onPatch={onPatch} />
      ))}
    </div>
  )

  return (
    <div className="tasklist">
      {inboxId && !compact && (
        <form className="add-row qa rem-add" onSubmit={addTask}>
          <IconClock size={16} />
          <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a scheduled task… (e.g. “file taxes friday !3”)" aria-label="Add a scheduled task" />
          <button type="submit" className="iconbtn sm" aria-label="Add task" title="Add task"><IconPlus size={16} /></button>
        </form>
      )}
      {inboxId && !compact && <QuickAddPreview text={draft} />}
      {inboxId && !compact && <div className="qa-hint">tomorrow · 9am · !1–5 · *label · -&gt; cue</div>}
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
              {rows(flatItems)}
              {moreCount > 0 && <div className="up-more" style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 13 }}>+{moreCount} more</div>}
            </>
          )
          : UPCOMING_ORDER.filter((k) => groups[k]).map((k) => {
            const isCol = collapsed.has(k)
            return (
              <div key={k} className={`up-sec${k === 'overdue' ? ' up-overdue' : ''}`}>
                <button type="button" className="group-head rem-head up-head" aria-expanded={!isCol} title={isCol ? 'Expand' : 'Collapse'} onClick={() => toggleGroup(k)}>
                  <IconChevR size={12} className={`rem-chev${isCol ? '' : ' open'}`} />
                  <span className="g-title">{groups[k].label}</span>
                  <span className="g-count">{groups[k].items.length}</span>
                </button>
                {!isCol && rows(groups[k].items)}
              </div>
            )
          }))}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
