import { useCallback, useMemo, useState } from 'react'
import { useTaskList } from '../useTasks.js'
import { computeReview, parseYmd } from '../reviewstats.js'
import { loadJson, saveJson } from '../storage.js'
import { emitTasksChanged } from '../tasksbus.js'
import { useWidgetSize } from '../useWidgetSize.js'
import { atLeastH, atMostW } from '../widgetsize.js'
import { SkeletonRows, EmptyState, ErrorState } from './parts.jsx'
import { IconChart, IconCheck } from '../icons.jsx'

const REVIEWED_KEY = 'review-last-reviewed'
const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Weekly review & feedback loop: completions this week vs last, a 7-day trend,
// a 30-day total, and a once-weekly "review & re-plan" nudge. Pure derived view
// over the shared task store — reads completed one-time tasks (STATUS:COMPLETED)
// plus habit-log dates; writes nothing to CalDAV. The "reviewed" timestamp is
// client-only UI state in localStorage (not SQLite, not CalDAV).
export default function ReviewWidget() {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load } = useTaskList(selector)
  const sz = useWidgetSize()

  const [lastReviewed, setLastReviewed] = useState(() => loadJson(REVIEWED_KEY, null))
  const review = useMemo(() => computeReview(tasks, new Date(), lastReviewed), [tasks, lastReviewed])

  const markReviewed = () => {
    const now = new Date().toISOString()
    saveJson(REVIEWED_KEY, now)
    setLastReviewed(now)
    emitTasksChanged() // nudge a refresh so the next-week rollover stays honest
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
            <div className="rv-prompt-sub">Skim what got done, clear stale items, and pick this week’s priorities.</div>
          </div>
          <button className="btn primary sm" onClick={markReviewed}><IconCheck size={14} /> Mark reviewed</button>
        </div>
      ) : (
        <div className="rv-reviewed"><IconCheck size={14} /> Reviewed this week</div>
      ))}
    </div>
  )
}
