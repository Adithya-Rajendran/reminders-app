import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskList, byImportanceThenDue, dueBucket, isRealDate, dueChip, timeLabel, PriorityDot, PRIORITIES, partitionByTier, widgetStore, orderPlanFirst, announce, SkeletonRows, EmptyState, ErrorState, ReconnectBanner, UndoBar, useWidgetSize, atMostW, atMostH, IconTarget, IconBell, IconChevR } from '../widget-sdk'
import './FocusWidget.css'

const DUR_KEY = 'focus-duration'
const PARK_KEY = 'focus-park'
const DEFAULT_MIN = 25
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// "What to work on now" + a focus session. Surfaces a SINGLE clear next action
// (flow needs a clear goal and minimal ambiguity — Csikszentmihalyi), ranked by
// urgency-then-importance (due-soon by importance, then the rest by priority — the
// same ranking the focus_next MCP tool returns). The timer length is adjustable
// (no hard 25/5 "science" claim — that interval is convention, not evidence). A
// quiet "reminders parked" count keeps routine interrupts from breaking focus
// (pull over push — Mark et al. 2016), and a parking note offloads loose ends to
// cut attention residue (Leroy 2009) when switching in.
export default function FocusWidget({ tasks: tasksCap, events, plan, instanceId }) {
  const sz = useWidgetSize()
  const compact = atMostW(sz, 'sm') || atMostH(sz, 'sm')
  const short = atMostH(sz, 'xs')
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const store = useMemo(() => widgetStore(instanceId), [instanceId])

  const open = useMemo(() => tasks.filter((t) => !t.done && !t.is_goal), [tasks])

  // Read the server-stored daily plan (written by DailyWidget via ctx.plan). A
  // state counter forces a re-read: bumped on the same-tab 'reminders:plan-changed'
  // CustomEvent, and on window focus so edits from other tabs/browsers (or an
  // integration) land when the user comes back — no polling.
  const [planTick, setPlanTick] = useState(0)
  useEffect(() => {
    const handler = () => setPlanTick((n) => n + 1)
    window.addEventListener('reminders:plan-changed', handler)
    window.addEventListener('focus', handler)
    return () => {
      window.removeEventListener('reminders:plan-changed', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])
  const [todayPlanIds, setTodayPlanIds] = useState([])
  useEffect(() => {
    let alive = true
    const today = new Date()
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    plan.get(ymd).then((r) => { if (alive) setTodayPlanIds(Array.isArray(r?.ids) ? r.ids : []) }).catch(() => { /* plan is additive UX — keep the last known list */ })
    return () => { alive = false }
  }, [plan, planTick])

  const ranked = useMemo(() => {
    const soon = open.filter((t) => isRealDate(t.due_date) && ['overdue', 'today'].includes(dueBucket(t.due_date).k)).sort(byImportanceThenDue)
    const soonSet = new Set(soon)
    const rest = open.filter((t) => !soonSet.has(t)).sort((a, b) => (b.priority || 0) - (a.priority || 0))
    return orderPlanFirst([...soon, ...rest], todayPlanIds)
  }, [open, todayPlanIds])
  const [skip, setSkip] = useState(0)
  const nowTask = ranked.length ? ranked[skip % ranked.length] : null

  // Completion beat: when the CURRENT task is checked off, the card used to just
  // swap to the next task with zero acknowledgment — the completion read as a
  // glitch. Show a transient (~2.5s) "Done ✓ — next: …" chip and announce the
  // same string for screen readers. The next title is computed from the ranked
  // list minus the completed task — the exact task the card will show next.
  const [beat, setBeat] = useState(null)
  const beatTimer = useRef(null)
  useEffect(() => () => clearTimeout(beatTimer.current), [])
  const completeNow = () => {
    if (!nowTask) return
    const rest = ranked.filter((t) => t.id !== nowTask.id)
    const next = rest.length ? rest[skip % rest.length] : null
    const msg = next ? `Done ✓ — next: ${next.title}` : 'Done ✓ — all clear'
    clearTimeout(beatTimer.current)
    setBeat(msg)
    beatTimer.current = setTimeout(() => setBeat(null), 2500)
    // No separate announce(): onToggle's undo bar announces its label, so route
    // the richer message THROUGH it — otherwise every completion speaks twice.
    onToggle(nowTask, { completedLabel: msg })
  }

  // How many plan tasks are still open (excluding the current one)?
  const planSet = useMemo(() => new Set(todayPlanIds), [todayPlanIds])
  const planRemaining = useMemo(
    () => open.filter((t) => planSet.has(t.id) && t.id !== nowTask?.id).length,
    [open, planSet, nowTask],
  )
  const nowIsFromPlan = !!nowTask && planSet.has(nowTask.id)

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
  const startTimer = () => { if (remaining <= 0) setRemaining(durationMin * 60); setSessionStart(Date.now()); setEndedSummary(null); setRunning(true) }
  const resetTimer = () => { setRunning(false); setRemaining(durationMin * 60); setEndedSummary(null) }

  // Reminders that fired during the session, split so a genuinely urgent one can
  // break through while routine ones stay quietly parked (pull over push).
  const sessionEvents = running ? (events || []).filter((e) => (e?.receivedAt || 0) > sessionStart) : []
  const { breakthrough, routine } = partitionByTier(sessionEvents)

  // When the timer hits 0 the live "N parked" strips above vanish (they only
  // render while running) — which broke the "review them when you finish"
  // promise. Snapshot what fired the moment the session ends and render it in
  // the end state; cleared on the next start/reset.
  const [endedSummary, setEndedSummary] = useState(null)
  const sessionEnded = remaining === 0 && !running && sessionStart > 0
  useEffect(() => {
    if (!sessionEnded) return
    const fired = (events || []).filter((e) => (e?.receivedAt || 0) > sessionStart)
    setEndedSummary(partitionByTier(fired))
  }, [sessionEnded])

  const [park, setPark] = useState(() => store.loadJson(PARK_KEY, ''))
  const [parkOpen, setParkOpen] = useState(false)
  // Parking a thought gave zero confirmation, so it read as text vanishing into a
  // void. Persistence is synchronous (device-local storage, never-throw), so show
  // a quiet debounced "saved" receipt — honest about the destination — once
  // typing pauses; announced once per panel-open so SRs aren't spammed per pause.
  const [parkSaved, setParkSaved] = useState(false)
  const parkTimers = useRef({})
  const parkAnnouncedRef = useRef(false)
  useEffect(() => { parkAnnouncedRef.current = false }, [parkOpen])
  useEffect(() => () => { clearTimeout(parkTimers.current.show); clearTimeout(parkTimers.current.hide) }, [])
  const savePark = (text) => {
    setPark(text); store.saveJson(PARK_KEY, text)
    setParkSaved(false)
    clearTimeout(parkTimers.current.show); clearTimeout(parkTimers.current.hide)
    parkTimers.current.show = setTimeout(() => {
      setParkSaved(true)
      if (!parkAnnouncedRef.current) { parkAnnouncedRef.current = true; announce('Thought parked — saved on this device') }
      parkTimers.current.hide = setTimeout(() => setParkSaved(false), 2000)
    }, 800)
  }

  // Only the "now task" card is data-dependent — the timer, session banners and
  // park-a-thought box are all local UI state, so they stay mounted through
  // loading/error instead of vanishing with the rest of the widget.
  const hasData = tasks.length > 0
  const chip = nowTask && dueChip(nowTask.due_date)
  const done = remaining === 0 && !running

  return (
    <div className={`focus${compact ? ' compact' : ''}${short ? ' short' : ''}`}>
      {state === 'loading' && <SkeletonRows n={3} />}
      {state === 'error' && !hasData && <ErrorState onRetry={load} />}
      {state === 'error' && hasData && <ReconnectBanner onRetry={load} />}

      {(state === 'ready' || (state === 'error' && hasData)) && (
        nowTask ? (
          <div className="focus-now">
            {/* In-flow full-width row (grid row 1 in the CSS) — this used to be
                absolutely positioned top-right of the card, which floated it
                directly on top of the title text at every widget size instead
                of reserving its own space. */}
            <div className="focus-eyebrow">
              <IconTarget size={14} /> {compact ? 'Focus' : 'Focus on'}
              {nowIsFromPlan && !short && (
                <span className="chip focus-plan-chip">From today's plan · {planRemaining} left</span>
              )}
            </div>
            <button className="focus-check" role="checkbox" aria-checked={false} aria-label={`Complete: ${nowTask.title}`} onClick={completeNow} />
            <div className="focus-now-body">
              <div className="focus-title">{nowTask.title}</div>
              {!short && <div className="focus-meta">
                <PriorityDot value={nowTask.priority || 0} />
                <span className="sr-only">Priority: {(PRIORITIES.find((p) => p.v === (nowTask.priority || 0)) || PRIORITIES[0]).label}</span>
                {chip && <span className={`chip ${chip.cls}`}>{chip.label}{timeLabel(nowTask.due_date) ? ' · ' + timeLabel(nowTask.due_date) : ''}</span>}
                {nowTask.cue && <span className="chip cue-chip"><span className="cue-arrow">→</span> {nowTask.cue}</span>}
                {ranked.length > 1 && <button className="focus-skip" title="Show another task" onClick={() => setSkip((s) => s + 1)}>skip <IconChevR size={11} /></button>}
              </div>}
            </div>
          </div>
        ) : (
          <EmptyState icon={IconTarget} title="Nothing to focus on" sub="No open tasks right now — enjoy the clear runway." />
        )
      )}

      {/* Transient completion acknowledgment (plain div — announce() covers SRs).
          Its entry animation is disabled under prefers-reduced-motion in the CSS. */}
      {beat && <div className="focus-beat">{beat}</div>}

      <div className={`focus-timer${running ? ' running' : ''}${done ? ' done' : ''}`}>
        <div className="focus-clock" aria-live="off">{done ? 'Done ✓' : fmtClock(remaining)}</div>
        {/* The ticking clock stays aria-live="off"; completion is announced once via
            this separate polite region (empty until done, so SRs read it on change). */}
        <span className="sr-only" role="status" aria-live="polite">{done ? 'Focus session complete' : ''}</span>
        {!running && !short && (
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

      {/* End of session: pay off the "parked" promise with the actual snapshot. */}
      {done && endedSummary && (endedSummary.breakthrough.length + endedSummary.routine.length) > 0 && (() => {
        const all = [...endedSummary.breakthrough, ...endedSummary.routine]
        const shown = all.slice(0, 4)
        return (
          <div className="focus-endpark">
            <div className="focus-endpark-head">
              <IconBell size={13} /> Parked while you focused
              {endedSummary.breakthrough.length > 0 && <span className="focus-endpark-urgent"> · {endedSummary.breakthrough.length} urgent</span>}
            </div>
            <ul className="focus-endpark-list">
              {shown.map((e, i) => <li key={i}>{e?.data?.event?.data?.task?.title || 'Reminder'}</li>)}
            </ul>
            {all.length > shown.length && <div className="focus-endpark-more">+{all.length - shown.length} more in the Reminders widget</div>}
          </div>
        )
      })()}

      {!short && <div className="focus-brain">
        <div className="focus-brain-row">
          <button type="button" className="focus-brain-head" aria-label={`Park a thought${!parkOpen && park.trim() ? ' (has saved text)' : ''}`} aria-expanded={parkOpen} onClick={() => setParkOpen((o) => !o)}>
            <IconChevR size={12} className={`rem-chev${parkOpen ? ' open' : ''}`} /> Park a thought{!parkOpen && park.trim() ? ' ·' : ''}
          </button>
          {parkOpen && parkSaved && <span className="focus-park-saved">Saved · on this device</span>}
        </div>
        {parkOpen && (
          <textarea className="input focus-park" aria-label="Park a thought" value={park} onChange={(e) => savePark(e.target.value)} placeholder="Dump loose ends here so they don’t pull at your attention…" />
        )}
      </div>}

      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
