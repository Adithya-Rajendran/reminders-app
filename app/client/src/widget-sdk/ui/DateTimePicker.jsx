import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ZERO_DATE, isRealDate } from '../../domain/tasklib.js'
import { IconBell, IconClock } from '../icons.jsx'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const pad = (n) => String(n).padStart(2, '0')
const sameDay = (a, m, d, v) => a && a.y === v.y && a.m === m && a.d === d

function monthGrid(year, month) {
  const startDow = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  while (cells.length % 7) cells.push(null)
  return cells
}

// A mini calendar + time popover for setting a task's date/time and an optional
// reminder at that time. Rendered in a portal with fixed positioning so it is
// never clipped by a small/scrolling widget; picks are click-driven.
export default function DateTimePicker({ anchorRef, value, hasReminder, onApply, onClose }) {
  const popRef = useRef(null)
  const init = (value && value !== ZERO_DATE && !isNaN(new Date(value).getTime())) ? new Date(value) : null
  const base = init || (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d })()
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() })
  const [sel, setSel] = useState(init ? { y: init.getFullYear(), m: init.getMonth(), d: init.getDate() } : null)
  const [time, setTime] = useState(pad(base.getHours()) + ':' + pad(base.getMinutes()))
  // Default the reminder ON when scheduling fresh (no existing due date) or when a
  // reminder already exists; keep it OFF only when re-editing a dated task that
  // deliberately has no reminder (preserve that choice).
  const [remind, setRemind] = useState(hasReminder || !isRealDate(value))
  const [pos, setPos] = useState(null)

  // Position the popover next to its anchor (below, flipped above if no room).
  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    const W = 268
    const H = popRef.current?.offsetHeight || 392
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
    let top = r.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6)
    setPos({ top, left, width: W })
  }, [anchorRef])
  useLayoutEffect(() => { place() }, [place])

  // Keep it anchored on scroll (capture, to catch the widget's own scroll) / resize.
  useEffect(() => {
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [place])

  // Dismiss on outside-click / Esc.
  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [anchorRef, onClose])

  // Restore focus to whatever opened us (the chip) on unmount. Captured at
  // mount — before the dialog steals focus — and deliberately NOT keyed on
  // `pos`: place() rebuilds that object on every scroll/resize, and re-running
  // this cleanup mid-life would re-capture `prev` from inside the dialog, so
  // closing would "restore" focus to a node that just unmounted (body).
  useEffect(() => {
    const prev = document.activeElement
    return () => { if (prev && prev.focus) prev.focus() }
  }, [])

  // Focus into the dialog once it's placed, and trap Tab. `ready` flips
  // false->true exactly once, so repositioning never yanks focus back to the
  // first chip.
  const ready = !!pos
  useEffect(() => {
    const node = popRef.current
    if (!node || !ready) return undefined
    const q = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    const focusables = () => [...node.querySelectorAll(q)].filter((el) => !el.disabled && el.offsetParent !== null && el.tabIndex !== -1)
    const t = setTimeout(() => { const f = focusables(); (f[0] || node).focus() }, 0)
    const onTab = (e) => {
      if (e.key !== 'Tab') return
      const f = focusables(); if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onTab)
    return () => { clearTimeout(t); node.removeEventListener('keydown', onTab) }
  }, [ready])

  const preset = (kind) => {
    const d = new Date()
    if (kind === 'tomorrow') d.setDate(d.getDate() + 1)
    if (kind === 'nextweek') d.setDate(d.getDate() + (8 - d.getDay()))
    setSel({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() })
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }
  const shiftMonth = (n) => setView((v) => { const t = v.m + n; return t < 0 ? { y: v.y - 1, m: 11 } : t > 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: t } })
  const apply = () => {
    if (!sel) return
    // A cleared time field falls back to the current/default time instead of midnight.
    const [hh, mm] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [base.getHours(), base.getMinutes()]
    const iso = new Date(sel.y, sel.m, sel.d, hh || 0, mm || 0, 0, 0).toISOString()
    onApply({ due_date: iso, reminder: remind ? iso : null })
  }

  const now = new Date()
  const todayV = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
  const grid = monthGrid(view.y, view.m)

  // Roving tabindex over the day grid (ARIA calendar pattern): exactly one day
  // is a Tab stop — 31 sequential Tab presses to cross a month is unusable —
  // and arrows move by day/week, PageUp/Down by month, Home/End across the week.
  const [focusD, setFocusD] = useState(null) // day-of-month currently holding the tab stop
  const gridFocusPending = useRef(false)
  const daysInView = new Date(view.y, view.m + 1, 0).getDate()
  const rovingDay = Math.min(
    focusD ?? ((sel && sel.y === view.y && sel.m === view.m) ? sel.d
      : (todayV.y === view.y && todayV.m === view.m) ? todayV.d : 1),
    daysInView,
  )
  const onGridKey = (e) => {
    const cur = Number(e.target?.dataset?.day) || rovingDay
    const dow = new Date(view.y, view.m, cur).getDay()
    const dayDelta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowUp' ? -7 : e.key === 'ArrowDown' ? 7
      : e.key === 'Home' ? -dow : e.key === 'End' ? 6 - dow : null
    const monthDelta = e.key === 'PageUp' ? -1 : e.key === 'PageDown' ? 1 : 0
    if (dayDelta === null && !monthDelta) return
    e.preventDefault()
    const t = monthDelta
      ? new Date(view.y, view.m + monthDelta, Math.min(cur, new Date(view.y, view.m + monthDelta + 1, 0).getDate()))
      : new Date(view.y, view.m, cur + dayDelta)
    setView({ y: t.getFullYear(), m: t.getMonth() })
    setFocusD(t.getDate())
    gridFocusPending.current = true
  }
  // Move DOM focus to the new tab stop after the (possibly month-switching)
  // re-render it triggered.
  useEffect(() => {
    if (!gridFocusPending.current) return
    gridFocusPending.current = false
    popRef.current?.querySelector(`.dt-grid [data-day="${rovingDay}"]`)?.focus()
  })

  if (!pos) return null
  return createPortal(
    <div ref={popRef} className="dtpick" role="dialog" aria-modal="true" aria-label="Pick date and time" tabIndex={-1} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>
      <div className="dt-presets">
        <button type="button" className="dt-chip" onClick={() => preset('today')}>Today</button>
        <button type="button" className="dt-chip" onClick={() => preset('tomorrow')}>Tomorrow</button>
        <button type="button" className="dt-chip" onClick={() => preset('nextweek')}>Next week</button>
      </div>
      <div className="dt-head">
        <button type="button" className="iconbtn sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
        <span className="dt-title">{MONTHS[view.m]} {view.y}</span>
        <button type="button" className="iconbtn sm" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
      </div>
      <div className="dt-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="dt-grid" onKeyDown={onGridKey}>
        {grid.map((d, i) => d === null
          ? <span key={i} />
          : (
            <button
              type="button" key={i} data-day={d} tabIndex={d === rovingDay ? 0 : -1}
              className={`dt-day${sameDay(sel, view.m, d, view) ? ' sel' : ''}${(todayV.y === view.y && todayV.m === view.m && todayV.d === d) ? ' today' : ''}`}
              aria-label={`${MONTHS[view.m]} ${d}, ${view.y}`}
              aria-pressed={!!sameDay(sel, view.m, d, view)}
              aria-current={(todayV.y === view.y && todayV.m === view.m && todayV.d === d) ? 'date' : undefined}
              onClick={() => setSel({ y: view.y, m: view.m, d })}
            >{d}</button>
          ))}
      </div>
      <div className="dt-time-row">
        <span className="dt-time-lbl"><IconClock size={14} /> Time</span>
        <input type="time" className="input dt-time" aria-label="Time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <label className="dt-remind">
        <input type="checkbox" className="switch" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
        <span><IconBell size={13} /> Remind me at this time</span>
      </label>
      <div className="dt-actions">
        <button type="button" className="btn ghost sm" onClick={() => onApply({ due_date: ZERO_DATE, reminder: null })}>Clear</button>
        <button type="button" className="btn primary sm" onClick={apply} disabled={!sel}>Set</button>
      </div>
    </div>,
    document.body,
  )
}
