import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useTaskList, widgetStore, useWidgetSize, usePopover, atLeastW, atLeastH,
  selectFrogScored, groupEisenhower, byImportanceThenDue, isRealDate,
  careerXp, levelForXp, levelProgress, taskXp, dailyStreak, countCompletions,
  DAILY_GOAL_DEFAULT, TRIAGE_XP, TRIAGE_DAILY_CAP,
  TaskRow, EstimateControl, DreadControl,
  dueChip, timeLabel, pdotClass,
  SkeletonRows, EmptyState, ErrorState, UndoBar,
  IconTrophy, IconBolt, IconFlame, IconFrog, IconGrid, IconList, IconGear,
} from '../widget-sdk'
import './TriageWidget.css'

const FROG_KEY = 'frog-pick'        // reuse the legacy keys so a migrated Frog
const DEFER_KEY = 'frog-deferrals'  // instance keeps its day-pin + deferral counter
const COMBO_WINDOW = 6000           // ms between completions to keep a (visual) combo
const QUEUE_CAP = 8
const QUADS = [
  { k: 'Q1', label: 'Do first', sub: 'important · urgent' },
  { k: 'Q2', label: 'Schedule', sub: 'important' },
  { k: 'Q3', label: 'Delegate', sub: 'urgent' },
  { k: 'Q4', label: 'Later', sub: 'neither' },
]
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// A task is "triaged" once it has both an effort estimate AND a schedule — the two
// decisions the triage method asks for. Everything still missing one is queued.
const needsTriage = (t) => !(t.time_estimate > 0 && isRealDate(t.due_date))

// Honor the OS "reduce motion" setting: we don't just zero animation durations
// (styles.css already does), we skip SPAWNING confetti / fly-up nodes entirely.
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(m.matches)
    m.addEventListener?.('change', onChange)
    return () => m.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

// Triage + gamification: eat-the-frog "boss", a triage queue (set an effort
// estimate + a schedule for each undecided task), and a derived XP/level layer.
//
// XP is a PURE DERIVED VIEW over completed work (careerXp over the task list),
// weighted by importance × effort × dread (see leveling.js) — so it can't be
// farmed by churning trivial tasks and it reinforces doing the important/dreaded
// thing first. The only persisted state is a device-local monotonic high-water
// mark (so a level never *drops* if CalDAV later loses an old completion) plus a
// small, daily-capped triage bonus. Completions themselves stay in CalDAV, so the
// derived score is the same on every device for free.
export default function TriageWidget({ tasks: tasksCap, instanceId }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onPatch, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const store = useMemo(() => widgetStore(instanceId), [instanceId])
  const sz = useWidgetSize()
  const reduced = useReducedMotion()

  const [view, setView] = useState('triage')
  const [celebrate, setCelebrate] = useState(() => store.loadJson('celebrate', 'full'))
  const [gearOpen, setGearOpen] = useState(false)
  const gearRef = usePopover(gearOpen, setGearOpen) // close on outside-click / Esc, like every other menu
  // Effective celebration tier: OS reduced-motion (or the 'minimal' setting) wins.
  const fx = reduced || celebrate === 'minimal' ? 'none' : celebrate // 'full' | 'restrained' | 'none'

  const allowMatrix = atLeastW(sz, 'sm')
  const effectiveView = allowMatrix ? view : 'triage'
  const showMeta = atLeastH(sz, 'sm')
  const wide = atLeastW(sz, 'lg')

  const todayKey = ymd(new Date())
  const open = useMemo(() => tasks.filter((t) => !t.done && !t.is_goal), [tasks])

  // ---- the day's frog (pinned per-day, with a deferral counter) ----
  const frog = useMemo(() => {
    const saved = store.loadJson(FROG_KEY, null)
    if (saved && saved.date === todayKey) { const hit = open.find((t) => t.id === saved.id); if (hit) return hit }
    return selectFrogScored(open)
  }, [open, todayKey])
  const [deferrals, setDeferrals] = useState(() => store.loadJson(DEFER_KEY, {}))
  useEffect(() => {
    if (state !== 'ready' || !frog) return
    const prev = store.loadJson(FROG_KEY, null)
    if (prev && prev.id === frog.id && prev.date !== todayKey) {
      const map = { ...store.loadJson(DEFER_KEY, {}), [frog.id]: (deferrals[frog.id] || 0) + 1 }
      store.saveJson(DEFER_KEY, map); setDeferrals(map)
    }
  }, [frog, todayKey, state])
  useEffect(() => { if (frog) store.saveJson(FROG_KEY, { date: todayKey, id: frog.id }) }, [frog, todayKey, store])
  const deferDays = (frog && deferrals[frog.id]) || 0

  // ---- triage queue: undecided tasks (no estimate or no schedule), frog aside ----
  const queue = useMemo(
    () => open.filter((t) => t.id !== (frog && frog.id) && needsTriage(t)).slice().sort(byImportanceThenDue).slice(0, QUEUE_CAP),
    [open, frog],
  )

  // ---- XP / level (PURE derived completions + monotonic device-local extras) ----
  // careerXp is a derived view over real completions (one-off done_at + habit-log
  // days). hwm is a persisted monotonic floor so a level never *drops* if CalDAV
  // later loses an old completion; bonus is the small triage reward. The displayed
  // total reads max(floor, live derived) so it tracks reality without regressing.
  const derived = useMemo(() => careerXp(tasks), [tasks])
  const [hwm, setHwm] = useState(() => store.loadJson('xpHwm', 0))
  const [bonus, setBonus] = useState(() => store.loadJson('xpBonus', 0))
  const total = Math.max(hwm, derived) + bonus
  const prog = levelProgress(total)

  // ---- today's ring + streak ----
  const doneToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    return countCompletions(tasks, start, end)
  }, [tasks])
  const goal = store.loadJson('dailyGoal', DAILY_GOAL_DEFAULT)
  const ringPct = Math.min(100, Math.round((doneToday / Math.max(1, goal)) * 100))
  const streak = useMemo(() => dailyStreak(tasks), [tasks])

  // ---- celebration state (fly-ups + level-up banner/confetti) ----
  const [flyups, setFlyups] = useState([])
  const [levelUp, setLevelUp] = useState(null)
  const [confetti, setConfetti] = useState([])
  const idRef = useRef(0)
  const comboRef = useRef({ t: 0, n: 0 })

  const pushFlyup = useCallback((amount, kind) => {
    const now = Date.now()
    const n = now - comboRef.current.t < COMBO_WINDOW ? comboRef.current.n + 1 : 1
    if (kind === 'task') comboRef.current = { t: now, n }
    const id = ++idRef.current
    setFlyups((f) => [...f, { id, amount, combo: kind === 'task' ? n : 1 }])
    setTimeout(() => setFlyups((f) => f.filter((x) => x.id !== id)), 1100)
  }, [])

  const fireLevelUp = useCallback((lvl) => {
    setLevelUp(lvl)
    setTimeout(() => setLevelUp((cur) => (cur === lvl ? null : cur)), 2200)
    if (fx === 'full') {
      // A modest confetti burst — class-based colours so they follow the theme.
      const pieces = Array.from({ length: 26 }, (_, i) => ({
        id: `${lvl}-${i}`, left: Math.round(Math.random() * 100), delay: Math.round(Math.random() * 180),
        rot: Math.round(Math.random() * 360), variant: i % 4,
      }))
      setConfetti(pieces)
      setTimeout(() => setConfetti([]), 1400)
    }
  }, [fx])

  // Animate (and raise the persisted floor) ONLY when the real completion total
  // rises — i.e. a one-off gained a done_at, or a habit logged a day. A recurring
  // task with no due date (server no-op) or a failed/reverted update never raises
  // `derived`, so it never (over-)awards — XP stays honest. Primed once tasks load
  // so existing history syncs silently instead of firing a giant fly-up on mount.
  const prevDerivedRef = useRef(0)
  const primedRef = useRef(false)
  useEffect(() => {
    if (state !== 'ready') return
    if (!primedRef.current) {
      primedRef.current = true
      prevDerivedRef.current = derived
      if (derived > hwm) { setHwm(derived); store.saveJson('xpHwm', derived) }
      return
    }
    const prev = prevDerivedRef.current
    prevDerivedRef.current = derived
    if (derived <= prev) return // optimistic removals / reverts only lower it — ignore
    if (derived > hwm) { setHwm(derived); store.saveJson('xpHwm', derived) }
    if (fx === 'none') return
    pushFlyup(derived - prev, 'task')
    const oldTotal = Math.max(hwm, prev) + bonus
    const newTotal = Math.max(hwm, derived) + bonus
    if (levelForXp(newTotal) > levelForXp(oldTotal)) fireLevelUp(levelForXp(newTotal))
  }, [derived, state]) // hwm/bonus/fx read fresh each run; exhaustive-deps is off project-wide

  // Award a small, daily-capped bonus the first time a task becomes fully triaged
  // (estimate + schedule) — rewarding the *decision*, which closes the open loop
  // (Masicampo & Baumeister 2011). Seeded silently on first run so pre-existing
  // triaged tasks don't retro-award.
  const triagedReady = useMemo(() => open.filter((t) => !needsTriage(t)).map((t) => t.id).join(','), [open])
  useEffect(() => {
    if (state !== 'ready') return
    let awarded = store.loadJson('triagedAwarded', null)
    const readyIds = open.filter((t) => !needsTriage(t)).map((t) => t.id)
    if (awarded === null) { // first run: seed, don't pay out history
      const seed = {}; for (const id of readyIds) seed[id] = 1
      store.saveJson('triagedAwarded', seed); return
    }
    let cap = store.loadJson('triageCap', { date: todayKey, used: 0 })
    if (cap.date !== todayKey) cap = { date: todayKey, used: 0 }
    let add = 0
    for (const id of readyIds) {
      if (awarded[id]) continue
      awarded = { ...awarded, [id]: 1 } // record once; recorded-but-unpaid can't pay later
      if (cap.used + TRIAGE_XP <= TRIAGE_DAILY_CAP) { cap.used += TRIAGE_XP; add += TRIAGE_XP } // explicit boundary
    }
    if (add > 0) {
      store.saveJson('triagedAwarded', awarded); store.saveJson('triageCap', cap)
      setBonus((b) => { const nb = b + add; store.saveJson('xpBonus', nb); return nb })
      if (fx !== 'none') pushFlyup(add, 'triage')
    } else { store.saveJson('triagedAwarded', awarded) }
  }, [triagedReady, state])

  const quads = useMemo(() => groupEisenhower(tasks, new Date()), [tasks])

  if (state === 'loading') return <div className="tasklist"><SkeletonRows n={4} /></div>
  if (state === 'error') return <div className="tasklist"><ErrorState onRetry={load} /></div>

  const setCelebrateMode = (m) => { setCelebrate(m); store.saveJson('celebrate', m); setGearOpen(false) }

  return (
    <div className="triage">
      {/* HUD: level + XP bar, today ring, streak, celebration setting */}
      <div className="tri-hud">
        <div className="tri-level" title={`Level ${prog.level} · ${prog.toNext} XP to next`}>
          <IconTrophy size={16} /> <b>Lv {prog.level}</b>
        </div>
        <div className="tri-xp">
          <div className="tri-xpbar"><div className="tri-xpfill" style={{ width: `${prog.pct}%` }} /></div>
          {atLeastW(sz, 'md') && <span className="tri-xptext">{prog.into} / {prog.span} XP</span>}
        </div>
        <span className="tri-ring" role="img" aria-label={`${doneToday} of ${goal} tasks done today`} style={{ '--p': ringPct }} title={`${doneToday} of ${goal} done today`}>
          <span className="tri-ring-n" aria-hidden="true">{doneToday}</span>
        </span>
        <span className={`tri-streak${streak > 0 ? ' on' : ''}`} title="Daily streak (≥1 done; today is grace)"><IconFlame size={13} /> {streak}</span>
        <span className="inline-ctl tri-gear-wrap" ref={gearRef}>
          <button className="iconbtn sm tri-gear" aria-label="Celebration settings" title="Celebration" onClick={() => setGearOpen((o) => !o)}><IconGear size={15} /></button>
          {gearOpen && (
            <div className="mini-menu tri-gear-menu" role="menu">
              {['full', 'restrained', 'minimal'].map((m) => (
                <button key={m} className={`mini-item${celebrate === m ? ' active' : ''}`} role="menuitemradio" aria-checked={celebrate === m} onClick={() => setCelebrateMode(m)}>
                  {m === 'full' ? 'Full — confetti & combos' : m === 'restrained' ? 'Restrained — level-ups only' : 'Minimal — numbers only'}
                </button>
              ))}
            </div>
          )}
        </span>
      </div>

      {allowMatrix && (
        <div className="seg tri-toggle" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'triage'} className={view === 'triage' ? 'on' : ''} onClick={() => setView('triage')} title="Triage queue"><IconList size={14} /> Triage</button>
          <button role="tab" aria-selected={view === 'matrix'} className={view === 'matrix' ? 'on' : ''} onClick={() => setView('matrix')} title="Eisenhower matrix"><IconGrid size={14} /> Matrix</button>
        </div>
      )}

      {effectiveView === 'matrix' ? (
        <div className="eisen">
          {QUADS.map((q) => (
            <div className={`eq eq-${q.k}`} key={q.k}>
              <div className="eq-head"><span className="eq-label">{q.label}</span><span className="eq-count">{quads[q.k].length}</span></div>
              {wide && <div className="eq-sub">{q.sub}</div>}
              <div className="eq-list">
                {quads[q.k].slice(0, wide ? 12 : 8).map((t) => {
                  const c = dueChip(t.due_date)
                  return (
                    <div className="eq-item" key={t.id} title={t.title}>
                      <span className={`pdot ${pdotClass(t.priority || 0)}`} />
                      <span className="eq-item-t">{t.title}</span>
                      {c && <span className={`chip ${c.cls}`}>{c.label}</span>}
                    </div>
                  )
                })}
                {quads[q.k].length === 0 && <div className="eq-empty">—</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* The frog "boss" — biggest XP of the day */}
          {frog ? (
            <div className="tri-boss">
              <div className="tri-boss-eyebrow"><IconFrog size={14} /> Today’s frog · boss</div>
              <button className="tri-boss-check" aria-label={`Complete: ${frog.title}`} onClick={() => onToggle(frog)} />
              <div className="tri-boss-body">
                <div className="tri-boss-title">{frog.title}</div>
                {showMeta && <div className="tri-boss-why">Your most important task — eat the frog before easier, busier work.</div>}
                <div className="tri-boss-meta">
                  {deferDays > 0 && <span className="chip tri-defer" title="Carried over from earlier days — worth tackling now">deferred {deferDays}×</span>}
                  <span className={`pdot ${pdotClass(frog.priority || 0)}`} />
                  {dueChip(frog.due_date) && <span className={`chip ${dueChip(frog.due_date).cls}`}>{dueChip(frog.due_date).label}{timeLabel(frog.due_date) ? ' · ' + timeLabel(frog.due_date) : ''}</span>}
                  <span className="chip tri-worth" title="XP for finishing this — importance × effort × dread"><IconBolt size={11} /> +{taskXp(frog)}</span>
                  <EstimateControl task={frog} onSet={(m) => onPatch(frog, { time_estimate: m })} />
                  <DreadControl value={frog.dread || 0} onSet={(d) => onPatch(frog, { dread: d })} />
                </div>
              </div>
            </div>
          ) : (
            <EmptyState icon={IconFrog} title="All clear" sub="No open tasks to start on — nice." />
          )}

          {/* Triage queue */}
          <div className="group-head tri-qhead"><span className="g-title">Triage queue</span><span className="g-count">{queue.length}</span></div>
          {queue.length === 0 ? (
            <div className="tri-empty">Everything’s estimated and scheduled — you’re fully triaged. 🎯</div>
          ) : (
            <div className="task-stream">
              {queue.map((t) => (
                <TaskRow
                  key={t.id} task={t}
                  onToggle={onToggle}
                  onSchedule={onSchedule}
                  onSetPriority={onSetPriority}
                  onPatch={onPatch}
                  onSetDread={(tt, d) => onPatch(tt, { dread: d })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Celebration overlay */}
      <div className="tri-fx" aria-hidden="true">
        {flyups.map((f) => (
          <span key={f.id} className={`tri-flyup${f.combo > 1 ? ' combo' : ''}`}>+{f.amount} XP{f.combo > 1 ? ` ·×${f.combo}` : ''}</span>
        ))}
        {confetti.map((c) => (
          <span key={c.id} className={`tri-confetti c${c.variant}`} style={{ left: `${c.left}%`, animationDelay: `${c.delay}ms`, '--rot': `${c.rot}deg` }} />
        ))}
      </div>
      {levelUp != null && (
        <div className={`tri-levelup${fx === 'full' ? ' full' : ''}`} role="status">
          <IconTrophy size={18} /> Level {levelUp}!
        </div>
      )}

      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
