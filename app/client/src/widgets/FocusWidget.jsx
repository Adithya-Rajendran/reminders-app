import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTaskList, byImportanceThenDue, dueBucket, isRealDate, dueChip, timeLabel, pdotClass, PRIORITIES, partitionByTier, widgetStore, SkeletonRows, EmptyState, ErrorState, UndoBar, IconTarget, IconBell, IconChevR } from '../widget-sdk'
import './FocusWidget.css'

const DUR_KEY = 'focus-duration'
const PARK_KEY = 'focus-park'
const DEFAULT_MIN = 25
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// "What to work on now" + a focus session. Surfaces a SINGLE clear next action
// (flow needs a clear goal and minimal ambiguity — Csikszentmihalyi), ranked by
// urgency-then-importance with dread factored in. The timer length is adjustable
// (no hard 25/5 "science" claim — that interval is convention, not evidence). A
// quiet "reminders parked" count keeps routine interrupts from breaking focus
// (pull over push — Mark et al. 2016), and a parking note offloads loose ends to
// cut attention residue (Leroy 2009) when switching in.
export default function FocusWidget({ tasks: tasksCap, events, instanceId }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const store = useMemo(() => widgetStore(instanceId), [instanceId])

  const open = useMemo(() => tasks.filter((t) => !t.done && !t.is_goal), [tasks])
  const ranked = useMemo(() => {
    const soon = open.filter((t) => isRealDate(t.due_date) && ['overdue', 'today'].includes(dueBucket(t.due_date).k)).sort(byImportanceThenDue)
    const soonSet = new Set(soon)
    const rest = open.filter((t) => !soonSet.has(t)).sort((a, b) => ((b.priority || 0) + (b.dread || 0)) - ((a.priority || 0) + (a.dread || 0)))
    return [...soon, ...rest]
  }, [open])
  const [skip, setSkip] = useState(0)
  const nowTask = ranked.length ? ranked[skip % ranked.length] : null

  // ---- focus timer ----
  const [durationMin, setDurationMin] = useState(() => store.loadJson(DUR_KEY, DEFAULT_MIN))
  const [remaining, setRemaining] = useState(durationMin * 60)
  const [running, setRunning] = useState(false)
  const [sessionStart, setSessionStart] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setRemaining((r) => { if (r <= 1) { setRunning(false); return 0 } return r - 1 }), 1000)
    return () => clearInterval(id)
  }, [running])
  const setDur = (min) => { const m = Math.max(5, Math.min(120, min)); setDurationMin(m); store.saveJson(DUR_KEY, m); if (!running) setRemaining(m * 60) }
  const startTimer = () => { if (remaining <= 0) setRemaining(durationMin * 60); setSessionStart(Date.now()); setRunning(true) }
  const resetTimer = () => { setRunning(false); setRemaining(durationMin * 60) }

  // Reminders that fired during the session, split so a genuinely urgent one can
  // break through while routine ones stay quietly parked (pull over push).
  const sessionEvents = running ? (events || []).filter((e) => (e?.receivedAt || 0) > sessionStart) : []
  const { breakthrough, routine } = partitionByTier(sessionEvents)

  const [park, setPark] = useState(() => store.loadJson(PARK_KEY, ''))
  const savePark = (text) => { setPark(text); store.saveJson(PARK_KEY, text) }
  const [parkOpen, setParkOpen] = useState(false)

  if (state === 'loading') return <div className="tasklist"><SkeletonRows n={3} /></div>
  if (state === 'error') return <div className="tasklist"><ErrorState onRetry={load} /></div>

  const chip = nowTask && dueChip(nowTask.due_date)
  const done = remaining === 0 && !running

  return (
    <div className="focus">
      {nowTask ? (
        <div className="focus-now">
          <div className="focus-eyebrow"><IconTarget size={14} /> Focus on</div>
          <button className="focus-check" role="checkbox" aria-checked={false} aria-label={`Complete: ${nowTask.title}`} onClick={() => onToggle(nowTask)} />
          <div className="focus-now-body">
            <div className="focus-title">{nowTask.title}</div>
            <div className="focus-meta">
              <span className={`pdot ${pdotClass(nowTask.priority || 0)}`} aria-hidden="true" />
              <span className="sr-only">Priority: {(PRIORITIES.find((p) => p.v === (nowTask.priority || 0)) || PRIORITIES[0]).label}</span>
              {chip && <span className={`chip ${chip.cls}`}>{chip.label}{timeLabel(nowTask.due_date) ? ' · ' + timeLabel(nowTask.due_date) : ''}</span>}
              {nowTask.cue && <span className="chip cue-chip"><span className="cue-arrow">→</span> {nowTask.cue}</span>}
              {ranked.length > 1 && <button className="focus-skip" title="Show another task" onClick={() => setSkip((s) => s + 1)}>skip <IconChevR size={11} /></button>}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState icon={IconTarget} title="Nothing to focus on" sub="No open tasks right now — enjoy the clear runway." />
      )}

      <div className={`focus-timer${running ? ' running' : ''}${done ? ' done' : ''}`}>
        <div className="focus-clock" aria-live="off">{done ? 'Done ✓' : fmtClock(remaining)}</div>
        {/* The ticking clock stays aria-live="off"; completion is announced once via
            this separate polite region (empty until done, so SRs read it on change). */}
        <span className="sr-only" role="status" aria-live="polite">{done ? 'Focus session complete' : ''}</span>
        {!running && (
          <div className="focus-dur">
            <button className="iconbtn sm" aria-label="Less time" onClick={() => setDur(durationMin - 5)}>−</button>
            <span className="focus-dur-val">{durationMin}m</span>
            <button className="iconbtn sm" aria-label="More time" onClick={() => setDur(durationMin + 5)}>+</button>
          </div>
        )}
        <div className="focus-timer-actions">
          {running
            ? <button className="btn ghost sm" onClick={() => setRunning(false)}>Pause</button>
            : <button className="btn primary sm" onClick={startTimer} disabled={!nowTask}>{remaining < durationMin * 60 && remaining > 0 ? 'Resume' : 'Start focus'}</button>}
          <button className="btn ghost sm" onClick={resetTimer}>Reset</button>
        </div>
      </div>

      {running && breakthrough.length > 0 && (
        <div className="focus-breakthrough" title="Urgent: overdue or high-priority reminders fired"><IconBell size={13} /> {breakthrough.length} urgent reminder{breakthrough.length > 1 ? 's' : ''} — worth a look</div>
      )}
      {running && routine.length > 0 && (
        <div className="focus-parked" title="Routine reminders fired while you focus — review them when you finish"><IconBell size={13} /> {routine.length} reminder{routine.length > 1 ? 's' : ''} parked</div>
      )}

      <div className="focus-brain">
        <button type="button" className="focus-brain-head" aria-expanded={parkOpen} onClick={() => setParkOpen((o) => !o)}>
          <IconChevR size={12} className={`rem-chev${parkOpen ? ' open' : ''}`} /> Park a thought{!parkOpen && park.trim() ? ' ·' : ''}
        </button>
        {parkOpen && (
          <textarea className="input focus-park" value={park} onChange={(e) => savePark(e.target.value)} placeholder="Dump loose ends here so they don’t pull at your attention…" />
        )}
      </div>

      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
