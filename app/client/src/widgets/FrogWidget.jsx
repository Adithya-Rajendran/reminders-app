import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTaskList, selectFrog, groupEisenhower, dueChip, timeLabel, pdotClass, widgetStore, useWidgetSize, atLeastW, atLeastH, SkeletonRows, EmptyState, ErrorState, UndoBar, IconFrog, IconGrid, IconList } from '../widget-sdk'
import './FrogWidget.css'

const FROG_KEY = 'frog-pick'
const DEFER_KEY = 'frog-deferrals'
const QUADS = [
  { k: 'Q1', label: 'Do first', sub: 'important · urgent' },
  { k: 'Q2', label: 'Schedule', sub: 'important' },
  { k: 'Q3', label: 'Delegate', sub: 'urgent' },
  { k: 'Q4', label: 'Later', sub: 'neither' },
]
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// "Eat the frog": one start-here highlight per day (highest priority, nearest
// due), plus an optional Eisenhower matrix. Pure derived view over existing
// PRIORITY × due fields — no new data. The day's frog is pinned in localStorage
// so it stays stable as you edit, until it's done or the day rolls over.
export default function FrogWidget({ tasks: tasksCap, instanceId }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const store = useMemo(() => widgetStore(instanceId), [instanceId])
  const [view, setView] = useState('frog')
  const sz = useWidgetSize()

  // The Eisenhower matrix is a 2×2 grid — illegible in a very narrow column, so
  // it's only offered (and the toggle only shown) once there's a bit of horizontal
  // room; below that the widget is the single "frog" highlight. Wider still, each
  // quadrant shows more items and its urgency caption. Short drops the meta chips.
  const allowMatrix = atLeastW(sz, 'sm')
  const effectiveView = allowMatrix ? view : 'frog'
  const showMeta = atLeastH(sz, 'sm')
  const wideMatrix = atLeastW(sz, 'lg')
  const perQuad = wideMatrix ? 12 : 8

  const open = useMemo(() => tasks.filter((t) => !t.done && !t.is_goal), [tasks])
  const todayKey = ymd(new Date())
  const frog = useMemo(() => {
    const saved = store.loadJson(FROG_KEY, null)
    if (saved && saved.date === todayKey) {
      const hit = open.find((t) => t.id === saved.id)
      if (hit) return hit
    }
    return selectFrog(open)
  }, [open, todayKey])

  // Deferral counter: when the same task is still the frog on a NEW day, it was
  // carried over — surface that gently. Evidence-honest framing: under load people
  // default to easier work (KC & Staats 2020), so a repeatedly-deferred top task
  // is worth flagging. No willpower/ego-depletion claims (that effect failed to
  // replicate). This effect runs before the FROG_KEY-writing one below, so it sees
  // the prior day's pin before it's overwritten.
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

  const quads = useMemo(() => groupEisenhower(tasks, new Date()), [tasks])

  if (state === 'loading') return <div className="tasklist"><SkeletonRows n={3} /></div>
  if (state === 'error') return <div className="tasklist"><ErrorState onRetry={load} /></div>

  return (
    <div className="frog">
      {allowMatrix && (
        <div className="frog-toggle">
          <button className={`seg${view === 'frog' ? ' on' : ''}`} onClick={() => setView('frog')} title="Today's frog"><IconList size={14} /> Frog</button>
          <button className={`seg${view === 'matrix' ? ' on' : ''}`} onClick={() => setView('matrix')} title="Eisenhower matrix"><IconGrid size={14} /> Matrix</button>
        </div>
      )}

      {effectiveView === 'frog' ? (
        frog ? (
          <div className="frog-card">
            <div className="frog-eyebrow"><IconFrog size={15} /> Start here today</div>
            <button className="frog-check" aria-label={`Complete: ${frog.title}`} onClick={() => onToggle(frog)} />
            <div className="frog-body">
              <div className="frog-title">{frog.title}</div>
              {showMeta && <div className="frog-why">Your most important task — do it before easier, busier work.</div>}
              {showMeta && (
                <div className="frog-meta">
                  {deferDays > 0 && <span className="chip frog-defer" title="Carried over from earlier days — worth tackling now">deferred {deferDays}×</span>}
                  <span className={`pdot ${pdotClass(frog.priority || 0)}`} />
                  {dueChip(frog.due_date) && <span className={`chip ${dueChip(frog.due_date).cls}`}>{dueChip(frog.due_date).label}{timeLabel(frog.due_date) ? ' · ' + timeLabel(frog.due_date) : ''}</span>}
                  {frog.cue && <span className="chip cue-chip"><span className="cue-arrow">→</span> {frog.cue}</span>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState icon={IconFrog} title="All clear" sub="No open tasks to start on — nice." />
        )
      ) : (
        <div className="eisen">
          {QUADS.map((q) => (
            <div className={`eq eq-${q.k}`} key={q.k}>
              <div className="eq-head"><span className="eq-label">{q.label}</span><span className="eq-count">{quads[q.k].length}</span></div>
              {wideMatrix && <div className="eq-sub">{q.sub}</div>}
              <div className="eq-list">
                {quads[q.k].slice(0, perQuad).map((t) => {
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
      )}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
