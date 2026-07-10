import { memo, useRef, useState } from 'react'
import { dueChip, PRIORITIES, timeLabel, absDate, cueTriggerOf } from '../../domain/tasklib.js'
import { PriorityDot } from './PriorityDot.jsx'
import { isQuickWin, isTwoMinName, isRecurringTask } from '../../domain/taskviews.js'
import { computeHabitStats, recentDays } from '../../domain/habitstats.js'
import { usePopover } from '../usePopover.js'
import { useMenuKeyNav } from './useMenuKeyNav.js'
import { useWidgetSize } from '../useWidgetSize.js'
import { atMostW } from '../../domain/widgetsize.js'
import { IconTrash, IconBell, IconFlame, IconPlus, IconChevR } from '../icons.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import TaskPopover from './TaskPopover.jsx'

const HABIT_DOTS = 14

// Compact habit consistency strip shown under a recurring task's row when a
// widget passes showHabit (the Reminders widget does). Reconstructed from the
// task's X-REMINDERS-HABIT-LOG — no extra fetch. Reuses the .habit-* tokens.
function HabitStrip({ task }) {
  const s = computeHabitStats(task, new Date())
  const dots = recentDays(task, new Date(), HABIT_DOTS)
  return (
    <div className="habit-strip">
      <span className="habit-dots" aria-hidden="true">
        {dots.map((d) => <span key={d.ms} className={`hdot${d.done ? ' done' : ''}`} />)}
      </span>
      <span className={`habit-streak${s.streak > 0 ? ' on' : ''}`} title="Current streak (forgiving)">
        <IconFlame size={12} /> {s.streak}
      </span>
      <span className="chip">{s.consistency30}% · 30d</span>
      {s.total > 0 && (
        <span className="habit-auto" title="Progress toward the ~66-day automaticity horizon">
          <span className="habit-auto-bar"><span className="habit-auto-fill" style={{ width: `${s.automaticityPct}%` }} /></span>
          day {Math.min(s.daysSinceStart, 66)}/66
        </span>
      )}
    </div>
  )
}

// Compact minutes label, e.g. 45 -> "45m", 90 -> "1h30", 120 -> "2h".
export const fmtEst = (min) => {
  const m = Math.max(0, Math.trunc(Number(min) || 0))
  if (!m) return ''
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h${r}` : `${h}h`
}
const EST_OPTIONS = [5, 15, 30, 45, 60, 90, 120]

const ClockMini = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
  </svg>
)

// An interactive task row: animated complete, inline priority menu + scheduler
// popover, and a hover-revealed delete affordance. Memoized: the handlers from
// useTaskList are stable, so a row only re-renders when its own `task` changes —
// editing/typing elsewhere in a list no longer re-renders every sibling row. It
// also re-renders when the enclosing widget crosses a size tier (context bypasses
// memo), which is what lets it shed secondary controls in a very narrow column.
function TaskRow({ task, onToggle, onDelete, onSchedule, onSetPriority, onSetCue, onPatch, showHabit, childTasks, onAddSubtask, dense: denseProp }) {
  const [burst, setBurst] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [subDraft, setSubDraft] = useState('')
  // Title click opens the shared quick-actions popover (Complete / Reschedule) — the
  // same one calendar chips use — so the title stops being a dead target. Only wired
  // when the row can actually reschedule (onSchedule present); otherwise the title
  // stays plain text (no regression for read-only rows).
  const [pop, setPop] = useState(null) // { rect } while the popover is open
  const titleRef = useRef(null)
  const canQuickActions = !!onSchedule
  const openPop = () => setPop({ rect: titleRef.current.getBoundingClientRect() })
  // In a very narrow column there's no room for the full control strip, so keep
  // the title + the due/schedule chip and drop the rest (priority, cue, labels,
  // quick-win, subtasks) — the row stays tappable and legible instead of wrapping.
  // A widget can also FORCE density via the `dense` prop when it embeds rows in a
  // cramped sub-layout (e.g. the triage matrix quadrants) regardless of its own
  // width tier — the two are OR'd, never fighting each other. (The hook is called
  // unconditionally — hiding it behind the || would break the Rules of Hooks.)
  const sz = useWidgetSize()
  const dense = denseProp || atMostW(sz, 'xs')
  const chip = dueChip(task.due_date)
  const repeats = (task.repeat_after || 0) > 0
  const cue = (task.cue || '').trim()
  const habit = showHabit && isRecurringTask(task)
  const kids = childTasks || []
  const total = kids.length
  const doneKids = kids.filter((k) => k.done).length
  const pct = total ? Math.round((doneKids / total) * 100) : 0
  const canSubtask = !!onAddSubtask

  const toggle = () => {
    if (!task.done) { setBurst(true); setTimeout(() => setBurst(false), 480) }
    onToggle(task)
  }
  const submitSub = (e) => {
    e.preventDefault()
    const v = subDraft.trim()
    if (!v) return
    setSubDraft('')
    onAddSubtask(task, v)
  }

  return (
    <div className="task-wrap">
      {/* data-task-id lets the omnibox reveal (scroll + flash) this row when a task
          is found by content search — see App.jsx onRevealTask. */}
      <div className={`task${task.done ? ' checked' : ''}`} data-task-id={task.id}>
        <button
          className={`check-btn${task.done ? ' on' : ''}${burst ? ' burst' : ''}`}
          role="checkbox"
          aria-checked={!!task.done}
          aria-label={`Complete: ${task.title}`}
          onClick={toggle}
        />
        <div className="task-main">
          <div className="task-title">
            {/* Importance is a first-class axis — surface it on EVERY row (a shape, not
                colour alone); urgency is carried by the due chip's colour below. */}
            {task.important && <span className="imp-star" title="Important" aria-label="Important">★</span>}
            <span
              className={`t${canQuickActions ? ' t-actions' : ''}`}
              ref={titleRef}
              {...(canQuickActions ? {
                role: 'button',
                tabIndex: 0,
                onClick: openPop,
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop() } },
              } : {})}
            >{task.title}</span>
            {repeats && <span className="repeat-badge" title="Repeating task">↻</span>}
          </div>
          <div className="task-sub">
            {!dense && <PriorityControl value={task.priority || 0} onSet={(p) => onSetPriority(task, p)} />}
            <DueControl task={task} chip={chip} onSchedule={(payload) => onSchedule(task, payload)} />
            {!dense && (onSetCue
              ? <CueControl task={task} onSetCue={onSetCue} onSetTrigger={onPatch ? (t, trig) => onPatch(t, { cue_trigger: trig }) : null} />
              : cue && <span className="chip cue-chip" title="If-then cue"><span className="cue-arrow">→</span> {cue}</span>)}
            {!dense && onPatch && <EstimateControl task={task} onSet={(m) => onPatch(task, { time_estimate: m })} />}
            {!dense && !onPatch && task.time_estimate > 0 && <span className="chip est-chip" title="Estimated time">~{fmtEst(task.time_estimate)}</span>}
            {!dense && isQuickWin(task) && <span className="chip qw-badge" title="Two-minute win — just do it now">⚡ 2 min</span>}
            {!dense && (task.labels || []).filter((l) => !isTwoMinName(l.title)).map((l) => <span key={l.id} className="label-chip">{`*${l.title}`}</span>)}
            {!dense && canSubtask && (
              <button type="button" className={`chip subtask-chip${total ? '' : ' hover-reveal empty'}`} aria-expanded={expanded} title={total ? `${doneKids}/${total} subtasks done` : 'Add a subtask'} onClick={() => setExpanded((e) => !e)}>
                <IconChevR size={11} className={`rem-chev${expanded ? ' open' : ''}`} />
                {total ? `${doneKids}/${total}` : '+ subtask'}
              </button>
            )}
            {!dense && total > 0 && <span className="subtask-bar" aria-hidden="true"><span className="subtask-fill" style={{ width: `${pct}%` }} /></span>}
          </div>
          {habit && <HabitStrip task={task} />}
        </div>
        {onDelete && (
          <button
            className="iconbtn sm task-del danger-hover hover-reveal"
            title="Delete task"
            aria-label={`Delete: ${task.title}`}
            onClick={() => onDelete(task)}
          >
            <IconTrash size={15} />
          </button>
        )}
      </div>
      {expanded && canSubtask && (
        <div className="task-children">
          {kids.map((c) => (
            <TaskRow key={c.id} task={c} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} onSetCue={onSetCue} onPatch={onPatch} />
          ))}
          <form className="add-row qa subtask-add" onSubmit={submitSub}>
            <input className="rem-text" value={subDraft} onChange={(e) => setSubDraft(e.target.value)} placeholder="Add a subtask…" aria-label="Add a subtask" />
            <button type="submit" className="iconbtn sm" aria-label="Add subtask" title="Add subtask"><IconPlus size={15} /></button>
          </form>
        </div>
      )}
      {pop && (
        <TaskPopover
          task={task}
          anchorRect={pop.rect}
          onComplete={() => { setPop(null); toggle() }}
          onSchedule={(t, payload) => { setPop(null); onSchedule(t, payload) }}
          onClose={() => setPop(null)}
        />
      )}
    </div>
  )
}

export default memo(TaskRow)

// ArrowDown on a closed menu trigger opens it — useMenuKeyNav then moves focus
// onto the first item, so the menu is arrow-key reachable without a click.
const openOnArrowDown = (open, setOpen) => (e) => {
  if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) }
}

function PriorityControl({ value, onSet }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  useMenuKeyNav(open, ref) // roving focus over the priority menuitems
  return (
    <span className="inline-ctl" ref={ref}>
      <button className="pri-dot-btn" aria-label={`Priority: ${PRIORITIES.find((p) => p.v === (value ?? 0))?.label || 'none'}`} title="Priority" aria-haspopup="menu" aria-expanded={open} onKeyDown={openOnArrowDown(open, setOpen)} onClick={() => setOpen((o) => !o)}>
        <PriorityDot value={value} />
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

// Inline editor for a task's implementation-intention cue ("when X -> do Y").
// Shown when a widget passes onSetCue; otherwise TaskRow renders a static chip.
// When onSetTrigger is supplied, the editor also captures a typed trigger KIND
// (time / location / after) — the machine-readable "when" of the if-then plan —
// which is what lets other widgets surface the cue contextually.
const CUE_KINDS = [
  { k: 'after', label: 'After' },
  { k: 'time', label: 'Time' },
  { k: 'location', label: 'Place' },
]
function CueControl({ task, onSetCue, onSetTrigger }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  const [val, setVal] = useState(task.cue || '')
  const [kind, setKind] = useState(task.cue_trigger?.kind || 'after')
  const cue = (task.cue || '').trim()
  const openEdit = () => { setVal(task.cue || ''); setKind(task.cue_trigger?.kind || cueTriggerOf(task.cue)?.kind || 'after'); setOpen(true) }
  const save = () => {
    const text = val.trim()
    onSetCue(task, text)
    if (onSetTrigger) onSetTrigger(task, text ? { kind, value: text } : null)
    setOpen(false)
  }
  const clear = () => { onSetCue(task, ''); if (onSetTrigger) onSetTrigger(task, null); setOpen(false) }
  return (
    <span className="inline-ctl" ref={ref}>
      <button className={`chip cue-chip${cue ? '' : ' hover-reveal empty'}`} title={task.cue_trigger ? `If-then cue (${task.cue_trigger.kind})` : 'If-then cue'} onClick={() => (open ? setOpen(false) : openEdit())}>
        <span className="cue-arrow">→</span> {cue || 'cue'}
      </button>
      {open && (
        <div className="mini-menu cue-pop" role="dialog">
          <input
            className="input cue-input"
            autoFocus
            value={val}
            placeholder="when… (e.g. after standup, at 9am)"
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') setOpen(false) }}
          />
          {onSetTrigger && (
            <div className="cue-kinds" role="group" aria-label="Trigger type">
              {CUE_KINDS.map((c) => (
                <button key={c.k} type="button" className={`cue-kind${kind === c.k ? ' on' : ''}`} onClick={() => setKind(c.k)}>{c.label}</button>
              ))}
            </div>
          )}
          <div className="cue-pop-row">
            {cue && <button className="btn ghost sm" onClick={clear}>Clear</button>}
            <button className="btn primary sm" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </span>
  )
}

// Quick time-estimate picker — supports the planning-fallacy countermeasure
// (estimating work) and feeds the Daily Planning roll-up. Minutes, or 0 to clear.
// Exported (via the widget-sdk barrel) so the Triage widget reuses the same picker.
export function EstimateControl({ task, onSet }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  useMenuKeyNav(open, ref) // roving focus over the estimate menuitems
  const est = Math.max(0, Math.trunc(Number(task.time_estimate) || 0))
  return (
    <span className="inline-ctl" ref={ref}>
      <button className={`chip est-chip${est ? '' : ' hover-reveal empty'}`} title="Estimated time" aria-haspopup="menu" aria-expanded={open} onKeyDown={openOnArrowDown(open, setOpen)} onClick={() => setOpen((o) => !o)}>
        {est ? '~' + fmtEst(est) : 'est'}
      </button>
      {open && (
        <div className="mini-menu" role="menu">
          {EST_OPTIONS.map((m) => (
            <button key={m} className={`mini-item${m === est ? ' active' : ''}`} role="menuitem" onClick={() => { onSet(m); setOpen(false) }}>{fmtEst(m)}</button>
          ))}
          {est > 0 && <button className="mini-item" role="menuitem" onClick={() => { onSet(0); setOpen(false) }}>Clear</button>}
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
        title={absDate(task.due_date) || 'Schedule'}
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
