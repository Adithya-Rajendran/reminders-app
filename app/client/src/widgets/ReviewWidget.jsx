import { useCallback, useMemo, useState } from 'react'
import { useTaskList, computeReview, parseYmd, selectStalled, dueBucket, isRealDate, widgetStore, useWidgetSize, atLeastH, atMostW, TaskRow, SkeletonRows, EmptyState, ErrorState, IconChart, IconCheck } from '../widget-sdk'
import './ReviewWidget.css'

const REVIEWED_KEY = 'review-last-reviewed'
const REFLECT_KEY = 'review-reflections'
const REFLECT_CAP = 52 // ~a year of weekly notes
const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
// A guided review, structured on GTD's three passes. The reflection step is the
// best-evidenced upgrade: brief written reflection measurably improves subsequent
// performance (Di Stefano et al., "Learning by Thinking").
const STEPS = [
  { key: 'clear', title: 'Get clear', sub: 'Reschedule or finish anything overdue.' },
  { key: 'current', title: 'Get current', sub: 'Give each stalled task a due date or a cue — a concrete next step.' },
  { key: 'creative', title: 'Get creative', sub: 'Reflect on the week, then name next week’s focus.' },
]

// Weekly review & feedback loop: completions this week vs last, a 7-day trend,
// a 30-day total, and a guided once-weekly review that ends in a written
// reflection. Pure derived stats over the shared task store; the "reviewed"
// timestamp and reflections are client-only UI state in localStorage.
export default function ReviewWidget({ tasks: tasksCap, instanceId }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onSchedule, onSetPriority, onSetCue, onPatch } = useTaskList(tasksCap, selector)
  const sz = useWidgetSize()
  const store = useMemo(() => widgetStore(instanceId), [instanceId])

  const [lastReviewed, setLastReviewed] = useState(() => store.loadJson(REVIEWED_KEY, null))
  const [reflections, setReflections] = useState(() => store.loadJson(REFLECT_KEY, []))
  const [step, setStep] = useState(-1) // -1 = not in the guided flow
  const [draft, setDraft] = useState('')
  const review = useMemo(() => computeReview(tasks, new Date(), lastReviewed), [tasks, lastReviewed])

  const overdue = useMemo(() => tasks.filter((t) => !t.done && isRealDate(t.due_date) && dueBucket(t.due_date).k === 'overdue'), [tasks])
  const stalled = useMemo(() => selectStalled(tasks), [tasks])

  const markReviewed = () => {
    const now = new Date().toISOString()
    store.saveJson(REVIEWED_KEY, now)
    setLastReviewed(now)
    tasksCap.emitChanged() // nudge a refresh so the next-week rollover stays honest
  }
  const finishReview = () => {
    const text = draft.trim()
    if (text) {
      const next = [{ iso: new Date().toISOString(), text }, ...reflections].slice(0, REFLECT_CAP)
      store.saveJson(REFLECT_KEY, next); setReflections(next)
    }
    setDraft(''); setStep(-1); markReviewed()
  }

  if (state === 'loading') return <div className="tasklist"><SkeletonRows n={4} /></div>
  if (state === 'error') return <div className="tasklist"><ErrorState onRetry={load} /></div>
  if (tasks.length === 0) {
    return (
      <div className="tasklist">
        <EmptyState icon={IconChart} title="Nothing to review yet" sub="Complete a few tasks and your weekly progress shows up here." />
      </div>
    )
  }

  // ---- guided review flow ----
  if (step >= 0) {
    const s = STEPS[step]
    const rowFor = (t) => <TaskRow key={t.id} task={t} onToggle={onToggle} onSchedule={onSchedule} onSetPriority={onSetPriority} onSetCue={onSetCue} onPatch={onPatch} />
    return (
      <div className="review rv-flowwrap">
        <div className="rv-flow-head">
          <span className="rv-flow-step">Step {step + 1} / {STEPS.length}</span>
          <span className="rv-flow-title">{s.title}</span>
        </div>
        <div className="rv-flow-sub">{s.sub}</div>
        <div className="rv-flow-body">
          {step === 0 && (overdue.length ? <div className="task-stream">{overdue.map(rowFor)}</div> : <div className="rv-flow-empty">Nothing overdue — clear. ✓</div>)}
          {step === 1 && (stalled.length ? <div className="task-stream">{stalled.map(rowFor)}</div> : <div className="rv-flow-empty">No stalled tasks — every open item has a next step. ✓</div>)}
          {step === 2 && (
            <textarea className="rv-reflect input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What went well? What got in the way? What’s the one thing to focus on next week?" />
          )}
        </div>
        <div className="rv-flow-nav">
          <button className="btn ghost sm" onClick={() => (step === 0 ? setStep(-1) : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</button>
          {step < STEPS.length - 1
            ? <button className="btn primary sm" onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn primary sm" onClick={finishReview}><IconCheck size={14} /> Finish review</button>}
        </div>
      </div>
    )
  }

  const max = Math.max(1, ...review.last7.map((d) => d.count))
  const up = review.deltaPct >= 0
  const deltaCls = review.thisWeek === review.lastWeek ? '' : up ? 'rv-up' : 'rv-down'

  // Content grows with vertical room (the layout stacks top -> spark -> meta ->
  // prompt). Very short: just the headline number + delta. A bit taller: add the
  // sparkline. At the default height and up: day labels, the 30/7-day chips, and
  // the weekly-review prompt. A narrow widget also trims the delta to arrow + %.
  const showSpark = atLeastH(sz, 'sm')
  const showDetails = atLeastH(sz, 'md')
  const showPrompt = atLeastH(sz, 'md')
  const compactDelta = atMostW(sz, 'xs')
  const lastReflection = reflections[0]

  return (
    <div className="review">
      <div className="rv-top">
        <div className="rv-stat">
          <div className="rv-big">{review.thisWeek}</div>
          <div className="rv-label">done this week</div>
        </div>
        <div className={`rv-delta ${deltaCls}`}>
          {review.thisWeek === review.lastWeek
            ? (compactDelta ? '=' : 'same as last week')
            : compactDelta
              ? `${up ? '▲' : '▼'} ${Math.abs(review.deltaPct)}%`
              : `${up ? '▲' : '▼'} ${Math.abs(review.deltaPct)}% vs last week (${review.lastWeek})`}
        </div>
      </div>

      {showSpark && (
        <div className="rv-spark" role="img" aria-label={`Completions over the last 7 days, ${review.last7Total} total`}>
          {review.last7.map((d) => (
            <div className="rv-bar-col" key={d.date} title={`${d.date}: ${d.count}`}>
              <div className="rv-bar-track">
                <div className={`rv-bar${d.count === 0 ? ' empty' : ''}`} style={{ height: `${d.count === 0 ? 4 : Math.round((d.count / max) * 100)}%` }} />
              </div>
              {showDetails && <div className="rv-bar-lbl">{DOW1[parseYmd(d.date).getDay()]}</div>}
            </div>
          ))}
        </div>
      )}

      {showDetails && (
        <div className="rv-meta">
          <span className="chip">{review.last30Total} in 30 days</span>
          <span className="chip">{review.last7Total} this week’s 7 days</span>
        </div>
      )}

      {showPrompt && (review.promptDue ? (
        <div className="rv-prompt">
          <div className="rv-prompt-body">
            <div className="rv-prompt-title">Weekly review &amp; re-plan</div>
            <div className="rv-prompt-sub">A guided pass: clear overdue, give stalled items a next step, then reflect.</div>
          </div>
          <button className="btn primary sm" onClick={() => { setDraft(''); setStep(0) }}><IconChart size={14} /> Start review</button>
        </div>
      ) : (
        <div className="rv-done-row">
          <span className="rv-reviewed"><IconCheck size={14} /> Reviewed this week</span>
          <button className="btn ghost sm" onClick={() => { setDraft(''); setStep(0) }}>Review again</button>
        </div>
      ))}

      {showDetails && lastReflection && (
        <div className="rv-last-reflect" title={lastReflection.text}>
          <span className="rv-last-label">Last reflection</span> {lastReflection.text}
        </div>
      )}
    </div>
  )
}
