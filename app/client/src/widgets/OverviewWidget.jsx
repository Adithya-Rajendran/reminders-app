import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useTaskList, applyOrganizer, useOrganizerFilter, groupEisenhower, byImportanceThenDue, dueBucket,
  isRealDate, parseQuickAdd, IconCheck, IconTarget, IconCalendar, IconPlus,
  SkeletonRows, ErrorState, ReconnectBanner, UndoBar,
} from '../widget-sdk'
import './OverviewWidget.css'

// Local time-of-day label for a calendar event start (e.g. "9:30 AM"). Kept here
// rather than reusing tasklib.timeLabel because that returns '' at midnight (it
// treats midnight as "all-day / no meaningful time" for a due date) — an event
// genuinely at midnight, or an all-day event, is handled explicitly below.
function eventTime(iso, allDay) {
  if (allDay) return 'All day'
  const d = new Date(iso)
  if (isNaN(d)) return ''
  let h = d.getHours()
  const m = d.getMinutes()
  const ap = h < 12 ? 'AM' : 'PM'
  h = h % 12 || 12
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`
}

// The ENGAGE summary — the "am I okay today?" answer that leads the default board.
// Deliberately compact and glanceable: one honest status line, the two numbers that
// actually change behavior (overdue + due-today), the single most-important thing to
// do now, the next thing on the calendar, and a way to capture a stray thought
// without leaving. It reads the SAME shared task store as every other widget, so a
// completion here updates the board at once. Respects the global organizer filter so
// when the user scopes the board to an Area/Context, this summary scopes with it.
export default function OverviewWidget({ tasks: tasksCap, calendar, organizer }) {
  // Select every task; the day-math (overdue/today/frog) is done here so the
  // selector stays a stable identity (a new array each render would thrash useMemo
  // in useTaskList). Filtering to open tasks happens below.
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, undo, dismissUndo } = useTaskList(tasksCap, selector)

  // React to the global active filter (Area/Context) via the shared SDK hook, so
  // when the user scopes the board this summary scopes with it.
  const filter = useOrganizerFilter(organizer)
  const scoped = useMemo(() => applyOrganizer(tasks, filter), [tasks, filter])

  // A single "now" per render pass so overdue/urgent/frog all agree on the instant.
  const now = useMemo(() => new Date(), [tasks, filter])

  // Open, actionable tasks (goals aren't "do it now" items).
  const open = useMemo(() => scoped.filter((t) => !t.done && !t.is_goal), [scoped])

  // Overdue = open tasks whose real due date is strictly before today.
  const overdue = useMemo(
    () => open.filter((t) => isRealDate(t.due_date) && dueBucket(t.due_date).k === 'overdue'),
    [open],
  )
  // Due today = open tasks whose due date falls today (overdue is counted separately).
  const dueToday = useMemo(
    () => open.filter((t) => isRealDate(t.due_date) && dueBucket(t.due_date).k === 'today'),
    [open],
  )

  // Today's most important task: the top of the Eisenhower Q1 (important AND urgent)
  // if any, else the importance-then-due ranking over all open tasks. This honors
  // the explicit importance axis first (groupEisenhower reads task.important), then
  // falls back so there's always a pick while nothing is flagged yet.
  const frog = useMemo(() => {
    const q1 = groupEisenhower(open, now).Q1
    if (q1.length) return q1.slice().sort(byImportanceThenDue)[0]
    return open.length ? open.slice().sort(byImportanceThenDue)[0] : null
  }, [open, now])

  // Honest status line. Overdue is the only thing that turns it "warn": a pile of
  // past-due items is the one state where "on track" would be a lie. Otherwise, if
  // anything is open we're "On track"; a truly empty open list is "Clear".
  const status = overdue.length > 0
    ? { cls: 'warn', text: overdue.length === 1 ? '1 overdue' : `${overdue.length} overdue` }
    : open.length > 0
      ? { cls: 'ok', text: 'On track' }
      : { cls: '', text: 'Clear' }

  // ---- next calendar event today (earliest still-upcoming) ----
  const [nextEvent, setNextEvent] = useState(null)
  useEffect(() => {
    if (!calendar?.listEvents) return
    let alive = true
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    calendar.listEvents(start.toISOString(), end.toISOString())
      .then((r) => {
        if (!alive) return
        const nowMs = Date.now()
        const upcoming = (r?.events || [])
          .filter((e) => e.start && (e.allDay || new Date(e.start).getTime() >= nowMs))
          .sort((a, b) => new Date(a.start) - new Date(b.start))
        setNextEvent(upcoming[0] || null)
      })
      // Calendar is a secondary read — a transient failure just leaves the last
      // known next event (or none); it must never blank the task-side summary.
      .catch(() => {})
    return () => { alive = false }
  }, [calendar])

  // ---- inline quick-capture -> Inbox (clarified:false) ----
  // Overview doesn't get the `projects` plug, so resolve the inbox project id from
  // an existing task (its project_id), falling back to 1 — the same fallback the
  // shared task hook uses. Capture is deliberately dumb: it only ever sets
  // clarified:false so the item lands in the Inbox to be clarified later.
  const inboxId = useMemo(() => tasks.find((t) => t.project_id != null)?.project_id ?? 1, [tasks])
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const capture = async (e) => {
    e.preventDefault()
    const raw = draft.trim()
    if (!raw) return
    setErr(''); setDraft('')
    const p = parseQuickAdd(raw)
    try {
      await tasksCap.create(inboxId, {
        title: p.title || raw,
        priority: p.priority || 0,
        clarified: false,
        ...(p.due_date ? { due_date: p.due_date } : {}),
        ...(p.labels?.length ? { labels: p.labels } : {}),
        ...(p.cue ? { cue: p.cue } : {}),
        ...(p.cue_trigger ? { cue_trigger: p.cue_trigger } : {}),
      })
      tasksCap.emitChanged(); load()
    } catch (e2) {
      setDraft(raw)
      let msg = 'Could not capture — check your CalDAV account in Settings.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  return (
    <div className="ov">
      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && tasks.length === 0 && <ErrorState onRetry={load} />}
      {state === 'error' && tasks.length > 0 && <ReconnectBanner onRetry={load} />}

      {(state === 'ready' || (state === 'error' && tasks.length > 0)) && (
        <>
          {/* (1) honest one-line status — word + redundant dot, never color alone */}
          <div className={`ov-status ${status.cls}`}>
            <span className="ov-dot" aria-hidden="true" />
            <span className="ov-status-text">{status.text}</span>
          </div>

          {/* (2) + (4) the two numbers that change behavior */}
          <div className="ov-metrics">
            <div className={`ov-metric${overdue.length > 0 ? ' warn' : ''}`}>
              <span className="ov-metric-num">{overdue.length}</span>
              <span className="ov-metric-lbl">Overdue</span>
            </div>
            <div className="ov-metric">
              <span className="ov-metric-num">{dueToday.length}</span>
              <span className="ov-metric-lbl">Due today</span>
            </div>
          </div>

          {/* (3) today's most important, with a real complete checkbox */}
          <div className="ov-frog">
            <div className="ov-sec-label"><IconTarget size={12} /> Most important</div>
            {frog ? (
              <div className="ov-frog-row">
                <button
                  type="button"
                  className="ov-check"
                  role="checkbox"
                  aria-checked="false"
                  aria-label={`Complete: ${frog.title}`}
                  title="Complete"
                  onClick={() => onToggle(frog)}
                >
                  <IconCheck size={14} />
                </button>
                <span className="ov-frog-title">{frog.title}</span>
              </div>
            ) : (
              <div className="ov-frog-none">Nothing to do — enjoy the clear deck.</div>
            )}
          </div>

          {/* (5) next calendar event today */}
          <div className="ov-event">
            <div className="ov-sec-label"><IconCalendar size={12} /> Next up</div>
            {nextEvent ? (
              <div className="ov-event-row">
                <span className="ov-event-time">{eventTime(nextEvent.start, nextEvent.allDay)}</span>
                <span className="ov-event-title">{nextEvent.title || '(untitled event)'}</span>
              </div>
            ) : (
              <div className="ov-event-none">No more events today.</div>
            )}
          </div>

          {/* (6) inline quick-capture -> Inbox */}
          <form className="add-row qa rem-add ov-add" onSubmit={capture}>
            <IconPlus size={16} />
            <input
              className="rem-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Capture a thought…  (lands in your Inbox)"
              aria-label="Capture a task to the Inbox"
            />
            <button type="submit" className="iconbtn sm" aria-label="Capture" title="Capture"><IconPlus size={16} /></button>
          </form>
          {err && <div role="alert" className="rem-err ov-err">{err}</div>}
        </>
      )}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
