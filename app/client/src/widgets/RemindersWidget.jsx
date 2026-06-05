import React, { useEffect, useState } from 'react'
import { IconBell, IconCheck, IconPlus, IconRefresh, IconCloud } from '../icons.jsx'

function relTime(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/* ---------- shared widget states ---------- */
function SkeletonRows({ n = 4 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="skel-task" key={i}>
          <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 9, flex: '0 0 auto' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skel-line" style={{ width: `${62 + (i * 13) % 30}%` }} />
            <div className="skeleton skel-line" style={{ width: `${30 + (i * 17) % 24}%`, marginTop: 7, height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
function EmptyState({ icon: Icon = IconBell, title, sub }) {
  return (
    <div className="state">
      <div className="state-ic"><Icon size={22} /></div>
      <div className="state-title">{title}</div>
      {sub && <div className="state-sub">{sub}</div>}
    </div>
  )
}
function ErrorState({ sub, onRetry }) {
  return (
    <div className="state error" role="alert">
      <div className="state-ic"><IconCloud size={22} /></div>
      <div className="state-title">Couldn’t load</div>
      <div className="state-sub">{sub || 'Lost connection to the event stream.'}</div>
      <button className="btn ghost sm" onClick={onRetry} style={{ marginTop: 4 }}>
        <IconRefresh size={14} /> Retry
      </button>
    </div>
  )
}

/* ---------- feed item ---------- */
function feedKind(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('reminder') || n.includes('due') || n.includes('overdue')) return 'due'
  if (n.includes('created') || n.includes('add')) return 'add'
  if (n.includes('done') || n.includes('complete') || n.includes('mark')) return 'done'
  return 'sync'
}
function feedIcon(kind) {
  if (kind === 'due') return { I: IconBell, cls: 'due' }
  if (kind === 'done') return { I: IconCheck, cls: 'done' }
  if (kind === 'add') return { I: IconPlus, cls: 'add' }
  return { I: IconRefresh, cls: 'sync' }
}
function humanName(name) {
  return String(name || 'event').replace(/^task\./, '').replace(/[._]/g, ' ').trim() || 'event'
}
function FeedItem({ item, fresh }) {
  const ev = (item && item.data && item.data.event) || (item && item.data) || {}
  const name = ev.event_name || ev.name || 'event'
  const task = ev?.data?.task?.title || ev?.task?.title || ev?.data?.title
  const kind = feedKind(name)
  const { I, cls } = feedIcon(kind)
  let text
  if (kind === 'due') text = task ? <span><b>{task}</b> is due</span> : <span>Reminder fired</span>
  else if (kind === 'add') text = task ? <span>New task <b>{task}</b> added</span> : <span>Task added</span>
  else if (kind === 'done') text = task ? <span><b>{task}</b> marked complete</span> : <span>Task completed</span>
  else text = task ? <span><b>{task}</b> · {humanName(name)}</span> : <span>{humanName(name)}</span>
  return (
    <div className={`feed-item${fresh ? ' fresh' : ''}`}>
      <span className={`feed-ic ${cls}`}><I size={16} /></span>
      <div className="feed-main">
        <div className="feed-text">{text}</div>
        <div className="feed-time">{relTime(item.at)}</div>
      </div>
    </div>
  )
}

// Live feed of reminder/overdue events pushed from Vikunja via the BFF SSE stream.
// `events` is owned by the dashboard (EventSource '/api/events'); we render it here.
export default function RemindersWidget({ events }) {
  const [, setTick] = useState(0)
  const [errored, setErrored] = useState(false)

  // Refresh relative timestamps periodically so "2m ago" stays accurate.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 20000)
    return () => clearInterval(id)
  }, [])

  const state = errored ? 'error' : events == null ? 'loading' : 'ready'
  const list = events || []

  // The dashboard's WidgetFrame provides the `.widget-body` scroll container; we
  // render the live-region body contents into it (height:100% so `.state` fills).
  return (
    <div aria-live="polite" aria-label="Live reminders feed" style={{ height: '100%' }}>
      {state === 'loading' && <SkeletonRows n={4} />}
      {state === 'error' && (
        <ErrorState sub="Lost connection to the event stream." onRetry={() => setErrored(false)} />
      )}
      {state === 'ready' && (
        list.length === 0 ? (
          <EmptyState
            icon={IconBell}
            title="No reminders yet"
            sub="New events stream in here as they happen."
          />
        ) : (
          list.map((e, i) => <FeedItem key={e.at + '-' + i} item={e} fresh={i === 0} />)
        )
      )}
    </div>
  )
}
