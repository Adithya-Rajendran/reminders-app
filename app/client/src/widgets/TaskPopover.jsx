import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DateTimePicker, dueChip, timeLabel, absDate, PriorityDot, IconCheck, IconClock } from '../widget-sdk'

// Quick-actions popover for a task chip on the calendar (Complete / Reschedule).
// Task chips used to be click-dead-ends there ("manage them in a task widget").
//
// Anchoring: the chip is a FullCalendar-owned element that can be torn down and
// re-rendered under us at any moment (any event-source refetch), so we anchor to
// the RECT captured at click time — plain numbers, no element reference. A portal
// with position:fixed keeps the popover out of react-grid-layout's CSS-transformed
// grid item (same containing-block trap the event modal documents).
//
// The parent resolves the LIVE task from the shared store each render and closes
// this popover when it disappears; Complete/Reschedule delegate to useTaskList
// handlers so the chip gets the exact same recurring-aware completion + Undo
// semantics as the task-row widgets.
export default function TaskPopover({ task, anchorRect, onComplete, onSchedule, onClose }) {
  const popRef = useRef(null)
  const schedRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [pickOpen, setPickOpen] = useState(false)

  // Place below the chip, flip above when out of room, clamp into the viewport
  // (same placement idiom as the SDK's AnchoredPopover / DateTimePicker).
  useLayoutEffect(() => {
    const W = 264
    const H = popRef.current?.offsetHeight || 130
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - W - 8))
    let top = anchorRect.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, anchorRect.top - H - 6)
    setPos({ top, left, width: W })
  }, [anchorRect])

  // usePopover-style focus restore: hand focus back to whatever had it before the
  // popover opened, but only if closing would orphan it (same idiom as the hook).
  const prevFocusRef = useRef(null)
  useEffect(() => {
    prevFocusRef.current = document.activeElement
    const node = popRef.current // capture: null by unmount time otherwise
    return () => {
      const active = document.activeElement
      const orphaned = !active || active === document.body || (node && node.contains(active))
      const prev = prevFocusRef.current
      if (orphaned && prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [])

  // usePopover-style dismissal (outside mousedown / Esc) — inlined rather than the
  // hook because the nested DateTimePicker portals to <body>: while it is open we
  // stand down entirely, so a click/Esc inside the picker (which is OUTSIDE our
  // subtree) dismisses the picker only, not the whole popover underneath it.
  useEffect(() => {
    if (pickOpen) return undefined // the picker owns dismissal while open
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [pickOpen, onClose])

  // Keyboard entry: land on the first action once the popover is placed.
  useEffect(() => { if (pos) popRef.current?.querySelector('button')?.focus() }, [pos !== null])

  const chip = dueChip(task.due_date)
  const t = timeLabel(task.due_date)

  if (!pos) return null
  return createPortal(
    <div
      ref={popRef} className="menu task-pop" role="dialog" aria-label={`Task: ${task.title}`}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 80 }}
    >
      <div className="task-pop-title">
        <PriorityDot value={task.priority || 0} standalone />
        <span className="task-pop-t">{task.title}</span>
        {(task.repeat_after || 0) > 0 && <span className="repeat-badge" title="Repeating task">↻</span>}
      </div>
      {chip && (
        <div className="task-pop-meta">
          <span className={`chip ${chip.cls}`} title={absDate(task.due_date) || undefined}>{chip.label}{t ? ' · ' + t : ''}</span>
        </div>
      )}
      <div className="task-pop-actions">
        <button type="button" className="btn primary sm" onClick={() => onComplete(task)}>
          <IconCheck size={14} /> Complete
        </button>
        <button
          type="button" ref={schedRef} className="btn ghost sm"
          aria-haspopup="dialog" aria-expanded={pickOpen}
          onClick={() => setPickOpen((o) => !o)}
        >
          <IconClock size={14} /> Reschedule
        </button>
      </div>
      {pickOpen && (
        <DateTimePicker
          anchorRef={schedRef}
          value={task.due_date}
          hasReminder={(task.reminders || []).length > 0}
          onApply={(payload) => { setPickOpen(false); onSchedule(task, payload) }}
          onClose={() => setPickOpen(false)}
        />
      )}
    </div>,
    document.body,
  )
}
