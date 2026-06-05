import React, { useEffect, useRef, useState } from 'react'
import { dueChip, isRealDate, pdotClass, PRIORITIES } from '../tasklib.js'

function usePopover(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen])
  return ref
}

const SCHED = [
  { k: 'today', label: 'Today' },
  { k: 'tomorrow', label: 'Tomorrow' },
  { k: 'weekend', label: 'This weekend' },
  { k: 'nextweek', label: 'Next week' },
  { k: 'clear', label: 'No date' },
]

const ClockMini = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
  </svg>
)

// An interactive task row: animated complete, inline priority menu + scheduler popover.
export default function TaskRow({ task, onToggle, onSetDue, onSetPriority }) {
  const [burst, setBurst] = useState(false)
  const chip = dueChip(task.due_date)
  const repeats = (task.repeat_after || 0) > 0

  const toggle = () => {
    if (!task.done) { setBurst(true); setTimeout(() => setBurst(false), 480) }
    onToggle(task)
  }

  return (
    <div className={`task${task.done ? ' checked' : ''}`}>
      <button
        className={`check-btn${task.done ? ' on' : ''}${burst ? ' burst' : ''}`}
        role="checkbox"
        aria-checked={!!task.done}
        aria-label={`Complete: ${task.title}`}
        onClick={toggle}
      />
      <div className="task-main">
        <div className="task-title">
          <span className="t">{task.title}</span>
          {repeats && <span className="repeat-badge" title="Repeating task">↻</span>}
        </div>
        <div className="task-sub">
          <PriorityControl value={task.priority || 0} onSet={(p) => onSetPriority(task, p)} />
          <DueControl chip={chip} hasDate={isRealDate(task.due_date)} onSet={(k) => onSetDue(task, k)} />
          {(task.labels || []).map((l) => <span key={l.id} className="label-chip">{l.title}</span>)}
        </div>
      </div>
    </div>
  )
}

function PriorityControl({ value, onSet }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  return (
    <span className="inline-ctl" ref={ref}>
      <button className="pri-dot-btn" aria-label="Set priority" title="Priority" onClick={() => setOpen((o) => !o)}>
        <span className={`pdot ${pdotClass(value)}`} />
      </button>
      {open && (
        <div className="mini-menu" role="menu">
          {PRIORITIES.map((p) => (
            <button key={p.v} className={`mini-item${p.v === value ? ' active' : ''}`} role="menuitem" onClick={() => { onSet(p.v); setOpen(false) }}>
              <span className={`pdot ${p.cls}`} /> {p.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function DueControl({ chip, hasDate, onSet }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  return (
    <span className="inline-ctl" ref={ref}>
      <button className={`chip due-chip${chip ? ' ' + chip.cls : ' empty'}`} onClick={() => setOpen((o) => !o)}>
        <ClockMini /> {chip ? chip.label : 'Schedule'}
      </button>
      {open && (
        <div className="mini-menu" role="menu">
          {SCHED.filter((s) => s.k !== 'clear' || hasDate).map((s) => (
            <button key={s.k} className="mini-item" role="menuitem" onClick={() => { onSet(s.k); setOpen(false) }}>{s.label}</button>
          ))}
        </div>
      )}
    </span>
  )
}
