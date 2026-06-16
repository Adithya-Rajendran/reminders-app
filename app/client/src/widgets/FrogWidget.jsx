import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTaskList } from '../useTasks.js'
import { selectFrog, groupEisenhower } from '../taskviews.js'
import { dueChip, timeLabel, pdotClass } from '../tasklib.js'
import { loadJson, saveJson } from '../storage.js'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconFrog, IconGrid, IconList } from '../icons.jsx'

const FROG_KEY = 'frog-pick'
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
export default function FrogWidget() {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, undo, dismissUndo } = useTaskList(selector)
  const [view, setView] = useState('frog')

  const open = useMemo(() => tasks.filter((t) => !t.done && !t.is_goal), [tasks])
  const todayKey = ymd(new Date())
  const frog = useMemo(() => {
    const saved = loadJson(FROG_KEY, null)
    if (saved && saved.date === todayKey) {
      const hit = open.find((t) => t.id === saved.id)
      if (hit) return hit
    }
    return selectFrog(open)
  }, [open, todayKey])
  useEffect(() => { if (frog) saveJson(FROG_KEY, { date: todayKey, id: frog.id }) }, [frog, todayKey])

  const quads = useMemo(() => groupEisenhower(tasks, new Date()), [tasks])

  if (state === 'loading') return <div className="tasklist"><SkeletonRows n={3} /></div>
  if (state === 'error') return <div className="tasklist"><ErrorState onRetry={load} /></div>

  return (
    <div className="frog">
      <div className="frog-toggle">
        <button className={`seg${view === 'frog' ? ' on' : ''}`} onClick={() => setView('frog')} title="Today's frog"><IconList size={14} /> Frog</button>
        <button className={`seg${view === 'matrix' ? ' on' : ''}`} onClick={() => setView('matrix')} title="Eisenhower matrix"><IconGrid size={14} /> Matrix</button>
      </div>

      {view === 'frog' ? (
        frog ? (
          <div className="frog-card">
            <div className="frog-eyebrow"><IconFrog size={15} /> Start here today</div>
            <button className="frog-check" aria-label={`Complete: ${frog.title}`} onClick={() => onToggle(frog)} />
            <div className="frog-body">
              <div className="frog-title">{frog.title}</div>
              <div className="frog-meta">
                <span className={`pdot ${pdotClass(frog.priority || 0)}`} />
                {dueChip(frog.due_date) && <span className={`chip ${dueChip(frog.due_date).cls}`}>{dueChip(frog.due_date).label}{timeLabel(frog.due_date) ? ' · ' + timeLabel(frog.due_date) : ''}</span>}
                {frog.cue && <span className="chip cue-chip"><span className="cue-arrow">→</span> {frog.cue}</span>}
              </div>
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
              <div className="eq-sub">{q.sub}</div>
              <div className="eq-list">
                {quads[q.k].slice(0, 8).map((t) => <div className="eq-item" key={t.id} title={t.title}>{t.title}</div>)}
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
