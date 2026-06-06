import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import { api, vk } from '../api.js'
import { emitTasksChanged, onTasksChanged } from '../tasksbus.js'
import { Calendar, X, Trash, Check, Spinner } from '../icons.jsx'

const ZERO_DATE = '0001-01-01T00:00:00Z'

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

function errText(e) {
  const m = String(e?.message || e || 'Something went wrong')
  try { return JSON.parse(m).error || m } catch { return m }
}

export default function CalendarWidget() {
  const calRef = useRef(null)
  const wrapRef = useRef(null)
  const [accounts, setAccounts] = useState([])
  const [modal, setModal] = useState(null) // null | { mode, key, initial }

  // Enabled CalDAV lists, flattened, for the create-modal <select>.
  const calendars = useMemo(() => {
    const out = []
    for (const a of accounts) {
      for (const l of (a.lists || [])) {
        if (!l.enabled) continue
        out.push({ accountId: a.id, listUrl: l.url, label: `${a.name} · ${l.displayName || l.url}` })
      }
    }
    return out
  }, [accounts])

  useEffect(() => {
    api('/api/caldav/accounts').then((r) => setAccounts(r.accounts || [])).catch(() => {})
  }, [])

  // Keep FullCalendar's internal sizing in sync with the resizable widget frame.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => calRef.current?.getApi().updateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const refetch = () => calRef.current?.getApi().refetchEvents()

  // Refetch when any other widget mutates a task, so the calendar stays in sync.
  useEffect(() => onTasksChanged(() => calRef.current?.getApi().refetchEvents()), [])

  // ---- merged event source: Vikunja tasks + CalDAV VTODOs + CalDAV events ----
  const loadEvents = useCallback((info, success, failure) => {
    const start = info.startStr, end = info.endStr
    Promise.allSettled([
      vk('/tasks?sort_by=due_date&order_by=asc&per_page=100'),
      api('/api/caldav/tasks'),
      api(`/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    ]).then(([vkRes, ctRes, evRes]) => {
      const out = []
      // (a) Vikunja tasks — green, read-only
      if (vkRes.status === 'fulfilled') {
        for (const t of (Array.isArray(vkRes.value) ? vkRes.value : [])) {
          if (!t.due_date || t.due_date === ZERO_DATE) continue
          out.push({
            id: 'vk-' + t.id, title: t.title, start: t.due_date, allDay: false, editable: true,
            classNames: ['cal-task', 'cal-task-vikunja'],
            extendedProps: { kind: 'task', source: 'vikunja', taskId: t.id, done: !!t.done },
          })
        }
      }
      // (b) CalDAV VTODOs — amber, read-only
      if (ctRes.status === 'fulfilled') {
        for (const t of (ctRes.value?.tasks || [])) {
          if (!t.due) continue
          out.push({
            id: 'ct-' + t.objectUrl, title: t.summary, start: t.due, allDay: false, editable: false,
            classNames: ['cal-task', 'cal-task-caldav'],
            extendedProps: { kind: 'task', source: 'caldav', objectUrl: t.objectUrl, accountId: t.accountId, done: !!t.done },
          })
        }
      }
      // (c) CalDAV events — indigo, editable
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
  }, [])

  // ---- interactions ----
  const onSelect = (arg) => {
    setModal({
      mode: 'create', key: 'c' + Date.now(),
      initial: { title: '', allDay: arg.allDay, start: toInput(arg.start, arg.allDay), end: toInput(arg.end, arg.allDay) },
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
        end: toInput(arg.event.end || arg.event.start, allDay),
        accountId: p.accountId, objectUrl: p.objectUrl, listUrl: p.listUrl,
      },
    })
  }

  // Drag / resize of an event -> PATCH in place; revert tasks and on failure.
  const onEventChange = async (arg) => {
    const p = arg.event.extendedProps
    // Drag a Vikunja task on the calendar -> reschedule its due date.
    if (p.kind === 'task' && p.source === 'vikunja') {
      try { await vk('/tasks/' + p.taskId, { method: 'POST', body: JSON.stringify({ due_date: arg.event.start?.toISOString() }) }); emitTasksChanged() }
      catch { arg.revert() }
      return
    }
    if (p.kind !== 'event') { arg.revert(); return }
    try {
      await api('/api/calendar/events', {
        method: 'PATCH',
        body: JSON.stringify({
          accountId: p.accountId, objectUrl: p.objectUrl,
          start: arg.event.start?.toISOString(),
          end: (arg.event.end || arg.event.start)?.toISOString(),
          allDay: arg.event.allDay,
        }),
      })
    } catch { arg.revert() }
  }

  // ---- modal submit handlers (throw -> surfaced by the modal) ----
  const submitModal = async (vals) => {
    if (modal.mode === 'create') {
      await api('/api/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          accountId: vals.accountId, listUrl: vals.listUrl, summary: vals.title,
          start: vals.start, end: vals.end, allDay: vals.allDay,
        }),
      })
    } else {
      await api('/api/calendar/events', {
        method: 'PATCH',
        body: JSON.stringify({
          accountId: vals.accountId, objectUrl: vals.objectUrl, summary: vals.title,
          start: vals.start, end: vals.end, allDay: vals.allDay,
        }),
      })
    }
    setModal(null)
    refetch()
  }

  const deleteModal = async (vals) => {
    await api('/api/calendar/events', {
      method: 'DELETE',
      body: JSON.stringify({ accountId: vals.accountId, objectUrl: vals.objectUrl }),
    })
    setModal(null)
    refetch()
  }

  return (
    <div className="cal-wrap" ref={wrapRef}>
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
        buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' }}
        height="100%"
        selectable
        selectMirror
        editable
        dayMaxEvents
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
      const startIso = fromInput(start)
      const endIso = fromInput(end)
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

  const remove = async () => {
    if (busy) return
    if (!confirm('Delete this event?')) return
    setBusy(true); setErr(null)
    try { await onDelete({ accountId: initial.accountId, objectUrl: initial.objectUrl }) }
    catch (e2) { setErr(errText(e2)); setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="ic"><Calendar size={20} /></span>
          <h2>{isCreate ? 'New event' : 'Edit event'}</h2>
          <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close"><X /></button>
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
                <Trash size={16} /> Delete
              </button>
            )}
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || noCalendars}>
              {busy ? <><Spinner /> Saving…</> : <><Check size={16} /> {isCreate ? 'Create' : 'Save'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
