import { useRef, useState } from 'react'
import { dueChip, pdotClass, PRIORITIES, timeLabel } from '../tasklib.js'
import { usePopover } from '../usePopover.js'
import { IconTrash, IconBell } from '../icons.jsx'
import DateTimePicker from './DateTimePicker.jsx'

const ClockMini = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
  </svg>
)

// An interactive task row: animated complete, inline priority menu + scheduler
// popover, and a hover-revealed delete affordance.
export default function TaskRow({ task, onToggle, onDelete, onSchedule, onSetPriority }) {
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
          <DueControl task={task} chip={chip} onSchedule={(payload) => onSchedule(task, payload)} />
          {(task.labels || []).map((l) => <span key={l.id} className="label-chip">{l.title}</span>)}
        </div>
      </div>
      {onDelete && (
        <button
          className="iconbtn sm task-del danger-hover"
          title="Delete task"
          aria-label={`Delete: ${task.title}`}
          onClick={() => onDelete(task)}
        >
          <IconTrash size={15} />
        </button>
      )}
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

// Opens a mini calendar + time picker; picking a date/time sets the due date and
// (by default) a reminder at that time. A bell on the chip means a reminder is set.
function DueControl({ task, chip, onSchedule }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const hasReminder = (task.reminders || []).length > 0
  const t = timeLabel(task.due_date)
  return (
    <span className="inline-ctl">
      <button
        ref={btnRef}
        className={`chip due-chip${chip ? ' ' + chip.cls : ' empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {hasReminder ? <IconBell size={12} /> : <ClockMini />} {chip ? chip.label : 'Schedule'}{chip && t ? ' · ' + t : ''}
      </button>
      {open && (
        <DateTimePicker
          anchorRef={btnRef}
          value={task.due_date}
          hasReminder={hasReminder}
          onApply={(payload) => { onSchedule(payload); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  )
}
