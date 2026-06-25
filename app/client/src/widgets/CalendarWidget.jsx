import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import { useWidgetSize, atMostW, atLeastW, ZERO_DATE, isTimedDue, useModalRef, UndoBar, IconCalendar, IconX, IconTrash, IconCheck, IconSpinner } from '../widget-sdk'

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

function errText(e) {
  const m = String(e?.message || e || 'Something went wrong')
  try { return JSON.parse(m).error || m } catch { return m }
}

export default function CalendarWidget({ tasks: tasksCap, calendar }) {
  const calRef = useRef(null)
  const wrapRef = useRef(null)
  const [accounts, setAccounts] = useState([])
  const [modal, setModal] = useState(null) // null | { mode, key, initial }

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

  const refetch = () => calRef.current?.getApi().refetchEvents()

  // Optimistic event delete with a 6s Undo (re-creates the event), mirroring the
  // task list's delete→undo — no jarring native confirm().
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)
  const dismissUndo = useCallback(() => { clearTimeout(undoTimer.current); setUndo(null) }, [])
  const showUndo = useCallback((label, fn) => {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])

  // Refetch when the shared task store changes — including optimistic edits made
  // in other widgets — so the calendar's task layer stays in sync.
  useEffect(() => tasksCap.subscribe(() => calRef.current?.getApi().refetchEvents()), [tasksCap])

  // ---- merged event source: reminders/tasks (from the shared store) + CalDAV events ----
  const loadEvents = useCallback((info, success, failure) => {
    const start = info.startStr, end = info.endStr
    Promise.allSettled([
      tasksCap.ensureLoaded(),
      calendar.listEvents(start, end),
    ]).then(([taskRes, evRes]) => {
      const out = []
      // (a) reminders/tasks with a date — shown once, draggable to reschedule.
      // (Single source: /api/tasks IS the CalDAV store, so no separate VTODO feed.)
      // Date-only tasks go in the all-day lane (not the timed grid, which would
      // clutter it); a task with a real time shows on the grid. Dragging a date
      // task onto a time slot sets a real time -> persisted as a time-block.
      if (taskRes.status === 'fulfilled') {
        for (const t of (Array.isArray(taskRes.value) ? taskRes.value : [])) {
          if (t.done || !t.due_date || t.due_date === ZERO_DATE) continue
          out.push({
            id: 'task-' + t.id, title: t.title, start: t.due_date, allDay: !isTimedDue(t.due_date), editable: true,
            classNames: ['cal-task', 'cal-task-local'],
            extendedProps: { kind: 'task', source: 'local', taskId: t.id, done: !!t.done },
          })
        }
      }
      // (b) CalDAV events — indigo, editable
      if (evRes.status === 'fulfilled') {
        for (const e of (evRes.value?.events || [])) {
          out.push({
            id: e.id, title: e.title, start: e.start, end: e.end, allDay: !!e.allDay,
            classNames: ['cal-event'],
            extendedProps: { kind: 'event', accountId: e.accountId, objectUrl: e.objectUrl, listUrl: e.listUrl, etag: e.etag },
          })
        }
      }
      success(out)
    }).catch(failure)
  }, [tasksCap, calendar])

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
    if (p.kind !== 'event') return // tasks are not editable
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
      showUndo('Event deleted', async () => {
        try { await calendar.createEvent(restore) } catch { /* best-effort restore */ }
        refetch()
      })
    } catch {
      refetch() // delete failed — restore the view and tell the user
      showUndo('Couldn’t delete the event', null)
    }
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
        events={loadEvents}
        select={onSelect}
        eventClick={onEventClick}
        eventDrop={onEventChange}
        eventResize={onEventChange}
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
      {undo && (
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 10, zIndex: 5 }}>
          <UndoBar undo={undo} dismiss={dismissUndo} />
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

  const switchAllDay = (next) => {
    setAllDay(next)
    setStart((v) => toInput(parseInput(v), next))
    setEnd((v) => toInput(parseInput(v), next))
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
