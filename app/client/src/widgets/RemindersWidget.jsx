import React, { useState } from 'react'
import { updateTask } from '../tasklib.js'
import { emitTasksChanged } from '../tasksbus.js'
import { IconBell, IconCheck, IconClock, IconX } from '../icons.jsx'

function taskOf(ev) { const e = ev?.data?.event || {}; return (e.data && e.data.task) || e.task || null }
function rel(at) {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago'
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago'
  return Math.round(h / 24) + 'd ago'
}
function kindOf(ev) {
  const n = (ev?.data?.event?.event_name || '').toLowerCase()
  if (n.includes('overdue')) return 'due'
  if (n.includes('reminder')) return 'due'
  if (n.includes('created')) return 'add'
  if (n.includes('done') || n.includes('updated')) return 'done'
  return 'sync'
}

// Live, actionable reminders feed — each fired reminder can be completed
// (with Undo), snoozed, or dismissed from the feed.
export default function RemindersWidget({ events }) {
  const [acted, setActed] = useState({})       // taskId -> 'done' | 'snoozed'
  const [dismissed, setDismissed] = useState({}) // taskId -> true

  // Collapse to one item per task (the most recent alert): a single task can
  // emit several events at once (reminder + overdue + updated) and we don't want
  // to show it three times.
  const byTask = new Map()
  ;(events || []).forEach((e, i) => {
    const t = taskOf(e); if (!t) return
    const prev = byTask.get(t.id)
    if (!prev || (e?.at ?? i) >= (prev.at ?? prev.i)) byTask.set(t.id, { e, at: e?.at, i, t })
  })
  const items = [...byTask.values()].filter(({ t }) => !dismissed[t.id])

  const complete = async (t) => { setActed((a) => ({ ...a, [t.id]: 'done' })); try { await updateTask(t.id, { done: true }); emitTasksChanged() } catch { /* */ } }
  const undoComplete = async (t) => {
    setActed((a) => { const n = { ...a }; delete n[t.id]; return n })
    try { await updateTask(t.id, { done: false }); emitTasksChanged() } catch { /* */ }
  }
  const snooze = async (t) => {
    setActed((a) => ({ ...a, [t.id]: 'snoozed' }))
    const iso = new Date(Date.now() + 3600e3).toISOString()
    try { await updateTask(t.id, { reminders: [{ reminder: iso }] }); emitTasksChanged() } catch { /* */ }
  }
  const dismiss = (id) => setDismissed((d) => ({ ...d, [id]: true }))

  if (items.length === 0) {
    return (
      <div className="state">
        <div className="state-ic"><IconBell size={22} /></div>
        <div className="state-title">No reminders yet</div>
        <div className="state-sub">Fired reminders &amp; overdue alerts stream in here live — complete, snooze, or dismiss them right here.</div>
      </div>
    )
  }

  return (
    <div className="feed">
      {items.map(({ e, t }) => {
        const a = acted[t.id]
        return (
          <div className={`feed-item${a ? ' acted' : ''}`} key={t.id}>
            <div className={`feed-ic ${kindOf(e)}`}><IconBell size={15} /></div>
            <div className="feed-main">
              <div className="feed-text"><b>{t.title}</b></div>
              <div className="feed-time">{a === 'done' ? 'Completed ✓' : a === 'snoozed' ? 'Snoozed 1h' : rel(e.at)}</div>
            </div>
            <div className="feed-actions">
              {!a && <button className="iconbtn sm" title="Complete" aria-label="Complete" onClick={() => complete(t)}><IconCheck size={15} /></button>}
              {!a && <button className="iconbtn sm" title="Snooze 1 hour" aria-label="Snooze 1 hour" onClick={() => snooze(t)}><IconClock size={15} /></button>}
              {a === 'done' && <button className="undo-btn sm-undo" title="Undo complete" onClick={() => undoComplete(t)}>Undo</button>}
              <button className="iconbtn sm danger-hover" title="Dismiss" aria-label="Dismiss reminder" onClick={() => dismiss(t.id)}><IconX size={15} /></button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
