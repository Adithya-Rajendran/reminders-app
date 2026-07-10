import './CalendarWidget.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import { useWidgetSize, atMostW, atLeastW, useModalRef, useTaskList, UndoBar, tasksToCalendarEvents, TaskPopover, SkeletonRows, ErrorState, ReconnectBanner, IconCalendar, IconX, IconTrash, IconCheck, IconSpinner } from '../widget-sdk'

// Read-only system calendars (e.g. Nextcloud "Contact birthdays") reject new
// events, so they must never appear in — let alone default — the create picker.
// Mirrors the server's isReadOnlySystemCalendar (caldav.js).
const isReadOnlyCal = (url) => /\/(contact_birthdays|birthdays)\/?(?:$|\?)/i.test(url || '')

// ---- date <-> <input> helpers (inputs are local time; ISO crosses the wire) ----
const pad = (n) => String(n).padStart(2, '0')
function toInput(d, allDay) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return ''
  const ymd = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  return allDay ? ymd : `${ymd}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}
function parseInput(v) {
  if (!v) return null
  const dt = v.length <= 10 ? new Date(v + 'T00:00:00') : new Date(v) // date-only -> local midnight
  return isNaN(dt.getTime()) ? null : dt
}
const fromInput = (v) => { const d = parseInput(v); return d ? d.toISOString() : null }
// Timed -> local ISO; all-day -> UTC midnight so the server's getUTC* date
// matches the picked day (avoids an off-by-one east of UTC). Shared by create,
// edit, and the delete→undo re-create.
const toIso = (v, allDay) => (allDay ? (v ? new Date(v + 'T00:00:00Z').toISOString() : null) : fromInput(v))
// All-day iCal DTEND is EXCLUSIVE (midnight after the last day). Show/edit the
// INCLUSIVE last day so a one-day event reads as one day, not two:
//  - toEndInput: exclusive end -> inclusive <input> value (shift back a day).
//  - toIsoEnd:   inclusive <input> value -> exclusive ISO for the server (+a day).
// Timed ends are unchanged. '' / null pass through (server defaults end = start+1d).
function toEndInput(d, allDay) {
  if (!d) return ''
  const dt = d instanceof Date ? new Date(d.getTime()) : new Date(d)
  if (isNaN(dt.getTime())) return ''
  if (allDay) dt.setDate(dt.getDate() - 1)
  return toInput(dt, allDay)
}
const toIsoEnd = (v, allDay) => {
  if (!allDay) return fromInput(v)
  if (!v) return null
  const d = new Date(v + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString()
}
function startOfWeek(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function fmtRange(start, end) {
  const last = addDays(end, -1)
  const mon = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric' })
  const full = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return start.getFullYear() === last.getFullYear() && start.getMonth() === last.getMonth()
    ? `${mon.format(start)} ${day.format(start)}-${day.format(last)}, ${last.getFullYear()}`
    : `${full.format(start)}-${full.format(last)}`
}
function fmtDay(d) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(d)
}
function fmtTime(v, allDay) {
  if (allDay) return 'All day'
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
}

function errText(e) {
  const m = String(e?.message || e || 'Something went wrong')
  try { return JSON.parse(m).error || m } catch { return m }
}

function MiniAgenda({ rangeStart, rangeEnd, items, loading, error, onRetry, onPrev, onNext, onToday, onTaskClick, onEventClick }) {
  const days = []
  for (let d = new Date(rangeStart); d < rangeEnd; d = addDays(d, 1)) {
    const day = new Date(d)
    const dayItems = items.filter((it) => sameDay(it.startDate, day))
    if (dayItems.length || sameDay(day, new Date())) days.push({ day, items: dayItems })
  }
  // A failed fetch used to blank straight to "Nothing scheduled" — indistinguishable
  // from a genuinely quiet week. If there's stale (or locally-sourced) data to show,
  // keep it up with a small reconnect strip; only swap to the full ErrorState when
  // there's truly nothing to show instead.
  const nothingToShow = error && items.length === 0
  return (
    <div className="cal-mini">
      <div className="cal-mini-toolbar">
        <div className="cal-mini-nav">
          <button type="button" className="iconbtn sm" aria-label="Previous week" onClick={onPrev}>‹</button>
          <button type="button" className="iconbtn sm" aria-label="Next week" onClick={onNext}>›</button>
        </div>
        <div className="cal-mini-title">{fmtRange(rangeStart, rangeEnd)}</div>
        <button type="button" className="btn ghost sm cal-mini-today" onClick={onToday}>Today</button>
      </div>
      {error && items.length > 0 && (
        <div className="cal-mini-reconnect"><ReconnectBanner onRetry={onRetry} /></div>
      )}
      <div className="cal-mini-list">
        {loading && <div className="cal-mini-empty"><IconSpinner size={16} /> Loading calendar…</div>}
        {!loading && nothingToShow && <ErrorState onRetry={onRetry} />}
        {!loading && !nothingToShow && days.length === 0 && <div className="cal-mini-empty">Nothing scheduled this week.</div>}
        {!loading && !nothingToShow && days.map(({ day, items: dayItems }) => (
          <section className="cal-mini-day" key={day.toISOString()}>
            <div className="cal-mini-day-head">
              <span>{fmtDay(day)}</span>
              {sameDay(day, new Date()) && <span>Today</span>}
            </div>
            {dayItems.length === 0 ? (
              <div className="cal-mini-none">No events</div>
            ) : (
              dayItems.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className={`cal-mini-item ${it.kind === 'task' ? 'task' : 'event'}`}
                  title={it.kind === 'task' ? 'Click for actions' : 'Edit event'}
                  onClick={(e) => (it.kind === 'task' ? onTaskClick(it.taskId, e) : onEventClick(it))}
                >
                  <span className="cal-mini-time">{fmtTime(it.start, it.allDay)}</span>
                  <span className="cal-mini-dot" aria-hidden="true" />
                  <span className="cal-mini-item-title">{it.title}</span>
                </button>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

export default function CalendarWidget({ tasks: tasksCap, calendar }) {
  const calRef = useRef(null)
  const wrapRef = useRef(null)
  const [accounts, setAccounts] = useState([])
  const [modal, setModal] = useState(null) // null | { mode, key, initial }

  // Adopt the shared task-list hook so the task-chip popover's Complete gets the
  // exact recurring-aware semantics + Undo the row widgets have (not a bespoke
  // tasksCap.update copy that would drift). The hook's store subscription is the
  // same store the task event-source below reads, so both stay in lockstep.
  const selectAll = useCallback((all) => all, [])
  const { tasks: storeTasks, onToggle, onSchedule, undo: taskUndo, dismissUndo: dismissTaskUndo } = useTaskList(tasksCap, selectAll)

  // The clicked task chip's popover. We keep { taskId, rect }: the id resolves to
  // the LIVE task at render (chips' extendedProps go stale the moment the store
  // mutates) and the rect — captured at click time — anchors the popover, since
  // FullCalendar may replace the chip element under us on any refetch.
  const [taskPop, setTaskPop] = useState(null)
  const popTask = taskPop ? storeTasks.find((tk) => tk.id === taskPop.taskId && !tk.done) : null
  useEffect(() => { if (taskPop && !popTask) setTaskPop(null) }, [taskPop, popTask]) // task gone (completed/deleted anywhere) -> close

  // Size class comes from the shared widget-size system (one observer in the
  // frame), so the toolbar, view, and compact styling adapt with the widget.
  const sz = useWidgetSize()
  const mini = atMostW(sz, 'sm')  // narrow column: agenda + minimal toolbar
  const full = atLeastW(sz, 'lg') // roomy: full view switcher, no compaction

  // Enabled CalDAV lists, flattened, for the create-modal <select>.
  const calendars = useMemo(() => {
    const out = []
    for (const a of accounts) {
      for (const l of (a.lists || [])) {
        if (!l.enabled) continue
        if (isReadOnlyCal(l.url)) continue // never offer a read-only calendar as an event target
        out.push({ accountId: a.id, listUrl: l.url, label: `${a.name} · ${l.displayName || l.url}` })
      }
    }
    return out
  }, [accounts])

  useEffect(() => {
    calendar.accounts().then((r) => setAccounts(r.accounts || [])).catch(() => {})
  }, [])

  // FullCalendar sizes to its container but only re-measures on WINDOW resize, so
  // nudge it whenever the (container-only) widget frame resizes. This observer is
  // purely that imperative sync — all size-class/content decisions come from the
  // shared hook above, so the classification logic isn't duplicated here.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => calRef.current?.getApi().updateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A month grid is unreadable in a narrow column, so switch to the agenda list
  // when mini and back to the month grid otherwise (the view switcher is hidden
  // while mini, so this is the only way to pick a view at that size). The all-day
  // lane + time grid for time-blocking are reachable via the Week view button.
  useEffect(() => {
    calRef.current?.getApi().changeView(mini ? 'listWeek' : 'dayGridMonth')
  }, [mini])

  // As the widget narrows, first shrink the toolbar (compact CSS) so the view
  // buttons fit on one row and stay out of the way; only when it's really small
  // drop the view switcher entirely, leaving prev/next + the title.
  const headerToolbar = mini
    ? { left: 'prev,next', center: 'title', right: 'today' }
    : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }

  // The two event sources refresh independently: task mutations only refetch the
  // store-backed overlay (zero network), and only event CRUD refetches VEVENTs —
  // the slowest call in the app no longer rides along on every task change.
  const refetchTasks = () => calRef.current?.getApi().getEventSourceById('tasks')?.refetch()
  const refetch = () => calRef.current?.getApi().getEventSourceById('vevents')?.refetch()

  // Optimistic event delete with a 6s Undo (re-creates the event), mirroring the
  // task list's delete→undo — no jarring native confirm().
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)
  const dismissUndo = useCallback(() => { clearTimeout(undoTimer.current); setUndo(null) }, [])
  const showUndo = useCallback((label, fn) => {
    dismissTaskUndo() // one bottom bar slot — the newest notice wins (see render)
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [dismissTaskUndo])
  // …and symmetrically: a fresh task undo (complete from the chip popover)
  // supersedes a pending event undo, so the single bar never shows a stale action.
  useEffect(() => { if (taskUndo) { clearTimeout(undoTimer.current); setUndo(null) } }, [taskUndo])

  // Refetch the task layer when the shared task store changes — including
  // optimistic edits made in other widgets. Only that layer: the store is local,
  // so a capture/complete elsewhere updates the calendar with zero network.
  useEffect(() => tasksCap.subscribe(refetchTasks), [tasksCap])

  // vevents load state — 'loading' | 'ready' | 'error', mirroring the shared task
  // store's own machine (taskstore.js) so a failed refetch reads the same way
  // everywhere in the app: the skeleton only for a load with nothing rendered
  // yet, a small reconnect strip once something has. taskSource never errors
  // (falls back to []), so only the vevents layer needs this.
  const [veventsState, setVeventsState] = useState('loading')
  const hadVeventsRef = useRef(false) // true once vevents has loaded at least once — ErrorState vs ReconnectBanner

  // ---- two event sources: (a) the task overlay from the shared store, (b) CalDAV VEVENTs ----
  // Split (was one merged source) so each refetches on its own trigger. Each half
  // resolves to [] on failure — one failing half must not blank the other (the
  // old allSettled behavior).
  const taskSource = useCallback((info, success) => {
    tasksCap.ensureLoaded().then((ts) => success(tasksToCalendarEvents(ts))).catch(() => success([]))
  }, [tasksCap])
  const veventSource = useCallback((info, success, failure) => {
    setVeventsState((s) => (s === 'ready' ? s : 'loading'))
    calendar.listEvents(info.startStr, info.endStr).then((r) => {
      success((r?.events || []).map((e) => ({
        id: e.id, title: e.title, start: e.start, end: e.end, allDay: !!e.allDay,
        classNames: ['cal-event'],
        extendedProps: { kind: 'event', accountId: e.accountId, objectUrl: e.objectUrl, listUrl: e.listUrl, etag: e.etag },
      })))
      hadVeventsRef.current = true
      setVeventsState('ready')
      // A transient failure keeps the previously-rendered events on screen
      // (failure(), not success([]) — which would blank the layer until the
      // next CRUD or view change now that task mutations no longer refetch it);
      // the overlays below tell the user why instead of a silently stale grid.
    }).catch((e) => { setVeventsState('error'); failure(e) })
  }, [calendar])

  // Recovery + cross-device freshness for the vevents layer: task mutations used
  // to (wastefully) refetch it many times a session; now that they don't, pick
  // up remote edits / heal a failed fetch when the user returns to the tab. The
  // server's ctag-revalidated cache makes this near-free.
  useEffect(() => {
    const onVis = () => { if (!document.hidden) refetch() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  const eventSources = useMemo(() => [
    { id: 'tasks', events: taskSource },
    { id: 'vevents', events: veventSource },
  ], [taskSource, veventSource])

  // Compact Calendar is a purpose-built agenda instead of FullCalendar's list
  // table. The table carries intrinsic widths that fight very narrow widgets;
  // this path keeps the same data and actions, but lays them out with normal
  // shrinkable flex/grid rules.
  const [miniAnchor, setMiniAnchor] = useState(() => new Date())
  const [miniTick, setMiniTick] = useState(0)
  const [miniEvents, setMiniEvents] = useState([])
  const [miniLoading, setMiniLoading] = useState(false)
  const [miniError, setMiniError] = useState(false)
  const miniRange = useMemo(() => {
    const start = startOfWeek(miniAnchor)
    const end = addDays(start, 7)
    return { start, end, startIso: start.toISOString(), endIso: end.toISOString() }
  }, [miniAnchor])
  const bumpMini = useCallback(() => setMiniTick((n) => n + 1), [])
  useEffect(() => {
    if (!mini) return
    let alive = true
    setMiniLoading(true)
    calendar.listEvents(miniRange.startIso, miniRange.endIso).then((r) => {
      if (!alive) return
      setMiniEvents((r?.events || []).map((e) => ({
        key: 'event-' + e.id,
        kind: 'event',
        id: e.id,
        title: e.title || '(untitled event)',
        start: e.start,
        startDate: new Date(e.start),
        end: e.end,
        allDay: !!e.allDay,
        accountId: e.accountId,
        objectUrl: e.objectUrl,
        listUrl: e.listUrl,
      })).filter((e) => !isNaN(e.startDate.getTime())))
      setMiniError(false)
    }).catch(() => {
      // Keep whatever was last fetched (plus the always-live local task overlay)
      // instead of blanking to [] — an error must read as an error (the
      // ReconnectBanner/ErrorState below), never as a quiet, event-free week.
      if (alive) setMiniError(true)
    })
      .finally(() => { if (alive) setMiniLoading(false) })
    return () => { alive = false }
  }, [calendar, mini, miniRange.startIso, miniRange.endIso, miniTick])
  const miniTasks = useMemo(() => tasksToCalendarEvents(storeTasks).map((e) => ({
    key: e.id,
    kind: 'task',
    title: e.title,
    start: e.start,
    startDate: new Date(e.start),
    allDay: !!e.allDay,
    taskId: e.extendedProps.taskId,
  })).filter((e) => !isNaN(e.startDate.getTime()) && e.startDate >= miniRange.start && e.startDate < miniRange.end), [storeTasks, miniRange.start, miniRange.end])
  const miniItems = useMemo(() => [...miniTasks, ...miniEvents].sort((a, b) => {
    const ad = a.startDate.getTime(), bd = b.startDate.getTime()
    if (ad !== bd) return ad - bd
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    return a.title.localeCompare(b.title)
  }), [miniTasks, miniEvents])

  // ---- interactions ----
  const onSelect = (arg) => {
    setModal({
      mode: 'create', key: 'c' + Date.now(),
      initial: { title: '', allDay: arg.allDay, start: toInput(arg.start, arg.allDay), end: toEndInput(arg.end, arg.allDay) },
    })
    calRef.current?.getApi().unselect()
  }

  const onEventClick = (arg) => {
    const p = arg.event.extendedProps
    // A task chip opens its quick-actions popover (Complete / Reschedule),
    // anchored to the chip's rect captured NOW — the element itself may be
    // replaced by FullCalendar before the popover re-renders.
    if (p.kind === 'task' && p.source === 'local') {
      const r = arg.el.getBoundingClientRect()
      setTaskPop({ taskId: p.taskId, rect: { top: r.top, left: r.left, bottom: r.bottom, width: r.width } })
      return
    }
    if (p.kind !== 'event') return
    const allDay = arg.event.allDay
    setModal({
      mode: 'edit', key: arg.event.id,
      initial: {
        title: arg.event.title, allDay,
        start: toInput(arg.event.start, allDay),
        end: toEndInput(arg.event.end, allDay) || toInput(arg.event.start, allDay),
        accountId: p.accountId, objectUrl: p.objectUrl, listUrl: p.listUrl,
      },
    })
  }

  // Drag / resize of an event -> PATCH in place; revert tasks and on failure.
  const onEventChange = async (arg) => {
    const p = arg.event.extendedProps
    // Drag a task on the calendar -> reschedule its due date.
    if (p.kind === 'task' && p.source === 'local') {
      try { await tasksCap.update(p.taskId, { due_date: arg.event.start?.toISOString() }); tasksCap.emitChanged() }
      catch { arg.revert() }
      return
    }
    if (p.kind !== 'event') { arg.revert(); return }
    try {
      await calendar.updateEvent({
        accountId: p.accountId, objectUrl: p.objectUrl,
        start: arg.event.start?.toISOString(),
        end: (arg.event.end || arg.event.start)?.toISOString(),
        allDay: arg.event.allDay,
      })
    } catch { arg.revert() }
  }

  // ---- modal submit handlers (throw -> surfaced by the modal) ----
  const submitModal = async (vals) => {
    if (modal.mode === 'create') {
      await calendar.createEvent({
        accountId: vals.accountId, listUrl: vals.listUrl, summary: vals.title,
        start: vals.start, end: vals.end, allDay: vals.allDay,
      })
    } else {
      await calendar.updateEvent({
        accountId: vals.accountId, objectUrl: vals.objectUrl, summary: vals.title,
        start: vals.start, end: vals.end, allDay: vals.allDay,
      })
    }
    setModal(null)
    refetch()
    bumpMini()
  }

  const deleteModal = async (ev) => {
    setModal(null)
    // Capture what we'd need to re-create the event if the user hits Undo.
    const restore = {
      accountId: ev.accountId, listUrl: ev.listUrl, summary: ev.title,
      start: toIso(ev.start, ev.allDay), end: toIsoEnd(ev.end, ev.allDay), allDay: !!ev.allDay,
    }
    try {
      await calendar.deleteEvent({ accountId: ev.accountId, objectUrl: ev.objectUrl })
      refetch()
      bumpMini()
      showUndo('Event deleted', async () => {
        try { await calendar.createEvent(restore) } catch { /* best-effort restore */ }
        refetch()
        bumpMini()
      })
    } catch {
      refetch() // delete failed — restore the view and tell the user
      bumpMini()
      showUndo('Couldn’t delete the event', null)
    }
  }

  if (mini) {
    return (
      <div className="cal-wrap cal-mini-wrap" ref={wrapRef} style={{ position: 'relative' }}>
        <MiniAgenda
          rangeStart={miniRange.start}
          rangeEnd={miniRange.end}
          items={miniItems}
          loading={miniLoading}
          error={miniError}
          onRetry={bumpMini}
          onPrev={() => setMiniAnchor((d) => addDays(d, -7))}
          onNext={() => setMiniAnchor((d) => addDays(d, 7))}
          onToday={() => setMiniAnchor(new Date())}
          onTaskClick={(taskId, e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setTaskPop({ taskId, rect: { top: r.top, left: r.left, bottom: r.bottom, width: r.width } })
          }}
          onEventClick={(ev) => setModal({
            mode: 'edit',
            key: ev.id,
            initial: {
              title: ev.title,
              allDay: ev.allDay,
              start: toInput(ev.start, ev.allDay),
              end: toEndInput(ev.end, ev.allDay) || toInput(ev.start, ev.allDay),
              accountId: ev.accountId,
              objectUrl: ev.objectUrl,
              listUrl: ev.listUrl,
            },
          })}
        />
        {modal && (
          <EventModal
            key={modal.key}
            mode={modal.mode}
            initial={modal.initial}
            calendars={calendars}
            onSubmit={submitModal}
            onDelete={deleteModal}
            onClose={() => setModal(null)}
          />
        )}
        {popTask && (
          <TaskPopover
            task={popTask}
            anchorRect={taskPop.rect}
            onComplete={(tk) => { setTaskPop(null); onToggle(tk) }}
            onSchedule={(tk, payload) => { setTaskPop(null); onSchedule(tk, payload) }}
            onClose={() => setTaskPop(null)}
          />
        )}
        {(taskUndo || undo) && (
          <div style={{ position: 'absolute', left: 12, right: 12, bottom: 10, zIndex: 5 }}>
            <UndoBar undo={taskUndo || undo} dismiss={taskUndo ? dismissTaskUndo : dismissUndo} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`cal-wrap${!full ? ' cal-compact' : ''}`} ref={wrapRef} style={{ position: 'relative' }}>
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={headerToolbar}
        buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' }}
        height="100%"
        selectable
        selectMirror
        editable
        dayMaxEventRows={full ? 4 : 3}
        nowIndicator
        eventDisplay="block"
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        eventDidMount={({ event, el }) => { if (event.extendedProps.kind === 'task') el.title = 'Click for actions · drag to reschedule' }}
        eventSources={eventSources}
        select={onSelect}
        eventClick={onEventClick}
        eventDrop={onEventChange}
        eventResize={onEventChange}
      />
      {/* vevents loading/error overlays sit ON TOP of FullCalendar rather than
          replacing it, so its mounted DOM/view state survives a fetch. A full
          scrim only while there's nothing rendered yet (initial load, or an
          error before any load has ever succeeded); once real data has shown
          once, a failed refetch gets a small non-blocking reconnect strip and
          the (stale) calendar underneath stays fully visible and usable. */}
      {veventsState === 'loading' && (
        <div className="cal-vevents-scrim" aria-hidden="true"><SkeletonRows n={4} /></div>
      )}
      {veventsState === 'error' && !hadVeventsRef.current && (
        <div className="cal-vevents-scrim"><ErrorState onRetry={refetch} /></div>
      )}
      {veventsState === 'error' && hadVeventsRef.current && (
        <div className="cal-vevents-reconnect"><ReconnectBanner onRetry={refetch} /></div>
      )}
      {modal && (
        <EventModal
          key={modal.key}
          mode={modal.mode}
          initial={modal.initial}
          calendars={calendars}
          onSubmit={submitModal}
          onDelete={deleteModal}
          onClose={() => setModal(null)}
        />
      )}
      {popTask && (
        <TaskPopover
          task={popTask}
          anchorRect={taskPop.rect}
          onComplete={(tk) => { setTaskPop(null); onToggle(tk) }}
          onSchedule={(tk, payload) => { setTaskPop(null); onSchedule(tk, payload) }}
          onClose={() => setTaskPop(null)}
        />
      )}
      {/* One bottom bar slot shared by the task undo (chip popover actions) and the
          event undo — whichever is active; each new notice dismisses the other. */}
      {(taskUndo || undo) && (
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 10, zIndex: 5 }}>
          <UndoBar undo={taskUndo || undo} dismiss={taskUndo ? dismissTaskUndo : dismissUndo} />
        </div>
      )}
    </div>
  )
}

function EventModal({ mode, initial, calendars, onSubmit, onDelete, onClose }) {
  const [title, setTitle] = useState(initial.title || '')
  const [allDay, setAllDay] = useState(!!initial.allDay)
  const [start, setStart] = useState(initial.start || '')
  const [end, setEnd] = useState(initial.end || '')
  const [calIdx, setCalIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const isCreate = mode === 'create'
  const noCalendars = isCreate && calendars.length === 0
  const dialogRef = useModalRef(onClose, { autoFocus: false }) // form's title input keeps autoFocus

  // Toggling all-day → timed used to inherit the parsed local-midnight time, so
  // the event silently landed at 00:00. Default to a working-hours time instead
  // (9:00 start / 10:00 end — matching the task scheduler's 9am default) while
  // preserving the picked date; a real non-midnight time is kept as-is.
  const switchAllDay = (next) => {
    setAllDay(next)
    const sane = (d, h) => {
      if (!d || next || d.getHours() !== 0 || d.getMinutes() !== 0) return d
      const x = new Date(d); x.setHours(h, 0, 0, 0); return x
    }
    setStart((v) => toInput(sane(parseInput(v), 9), next))
    setEnd((v) => toInput(sane(parseInput(v), 10), next))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const startIso = toIso(start, allDay)
      const endIso = toIsoEnd(end, allDay)
      if (!title.trim()) throw new Error('Give the event a title.')
      if (!startIso) throw new Error('Pick a start date/time.')
      if (isCreate) {
        const cal = calendars[calIdx]
        if (!cal) throw new Error('Choose a calendar.')
        await onSubmit({ title: title.trim(), start: startIso, end: endIso, allDay, accountId: cal.accountId, listUrl: cal.listUrl })
      } else {
        await onSubmit({ title: title.trim(), start: startIso, end: endIso, allDay, accountId: initial.accountId, objectUrl: initial.objectUrl })
      }
    } catch (e2) { setErr(errText(e2)); setBusy(false) }
  }

  // Optimistic: hand the original event up to be deleted with a 6s Undo (no
  // native confirm). The parent closes this modal and shows the UndoBar.
  const remove = () => { if (!busy) onDelete(initial) }

  // Portal to <body>: the widget lives inside react-grid-layout's CSS-transformed
  // grid item, which would otherwise become the containing block for this
  // position:fixed overlay and trap/clip it inside the calendar cell.
  return createPortal((
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="event-modal-title">
        <div className="modal-head">
          <span className="ic"><IconCalendar size={20} /></span>
          <h2 id="event-modal-title">{isCreate ? 'New event' : 'Edit event'}</h2>
          <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        <form className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={submit}>
          <div className="field">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" autoFocus required />
          </div>

          <label className="allday-row">
            <input type="checkbox" className="check" checked={allDay} onChange={(e) => switchAllDay(e.target.checked)} />
            All-day
          </label>

          <div className="field-row">
            <div className="field">
              <label>Start</label>
              <input type={allDay ? 'date' : 'datetime-local'} value={start} onChange={(e) => setStart(e.target.value)} required />
            </div>
            <div className="field">
              <label>End</label>
              <input type={allDay ? 'date' : 'datetime-local'} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          {isCreate && (
            <div className="field">
              <label>Calendar</label>
              {noCalendars ? (
                <div className="hint">No CalDAV calendars enabled. Enable one in <b>Settings → CalDAV</b> first.</div>
              ) : (
                <select value={calIdx} onChange={(e) => setCalIdx(Number(e.target.value))}>
                  {calendars.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
                </select>
              )}
            </div>
          )}

          {err && <div className="err">{err}</div>}

          <div className="modal-foot" style={{ padding: 0, borderTop: 0 }}>
            {!isCreate && (
              <button type="button" className="btn danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>
                <IconTrash size={16} /> Delete
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || noCalendars}>
              {busy ? <><IconSpinner size={16} /> Saving…</> : <><IconCheck size={16} /> {isCreate ? 'Create' : 'Save'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  ), document.body)
}
