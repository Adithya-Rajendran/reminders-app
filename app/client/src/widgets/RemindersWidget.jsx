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
// Only fired reminders / overdue alerts belong in this feed — not every task
// create/update event that flows over the same SSE channel.
const isReminder = (ev) => kindOf(ev) === 'due'

// Live, actionable reminders feed — each fired reminder can be completed
// (with Undo), snoozed (with Undo), or dismissed.
export default function RemindersWidget({ events }) {
  const [acted, setActed] = useState({})       // taskId -> 'done' | 'rescheduled' | 'snoozed'
  const [dismissed, setDismissed] = useState({}) // taskId -> true
  const [priorRem, setPriorRem] = useState({})  // taskId -> reminders[] captured before snooze

  // One item per task (the most recent reminder/overdue alert).
  const byTask = new Map()
  ;(events || []).forEach((e, i) => {
    if (!isReminder(e)) return
    const t = taskOf(e); if (!t) return
    const prev = byTask.get(t.id)
    if (!prev || (e?.at ?? i) >= (prev.at ?? prev.i)) byTask.set(t.id, { e, at: e?.at, i, t })
  })
  const items = [...byTask.values()].filter(({ t }) => !dismissed[t.id])

  const complete = async (t) => {
    setActed((a) => ({ ...a, [t.id]: 'done' }))
    try {
      const r = await updateTask(t.id, { done: true })
      emitTasksChanged()
      // Recurring tasks come back not-done with a bumped due date — label honestly.
      if (r && r.done === false) setActed((a) => ({ ...a, [t.id]: 'rescheduled' }))
    } catch { setActed((a) => { const n = { ...a }; delete n[t.id]; return n }) }
  }
  const undoComplete = async (t) => {
    setActed((a) => { const n = { ...a }; delete n[t.id]; return n })
    try { await updateTask(t.id, { done: false }); emitTasksChanged() } catch { /* */ }
  }
  const snooze = async (t) => {
    setPriorRem((m) => ({ ...m, [t.id]: Array.isArray(t.reminders) ? t.reminders : [] }))
    setActed((a) => ({ ...a, [t.id]: 'snoozed' }))
    const iso = new Date(Date.now() + 3600e3).toISOString()
    try { await updateTask(t.id, { reminders: [{ reminder: iso }] }); emitTasksChanged() } catch { /* */ }
  }
  const undoSnooze = async (t) => {
    const prior = priorRem[t.id] || []
    setActed((a) => { const n = { ...a }; delete n[t.id]; return n })
    try { await updateTask(t.id, { reminders: prior }); emitTasksChanged() } catch { /* */ }
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

  const label = (a, at) => a === 'done' ? 'Completed ✓' : a === 'rescheduled' ? 'Rescheduled ↻' : a === 'snoozed' ? 'Snoozed 1h' : rel(at)

  return (
    <div className="feed">
      {items.map(({ e, t }) => {
        const a = acted[t.id]
        return (
          <div className={`feed-item${a ? ' acted' : ''}`} key={t.id}>
            <div className={`feed-ic ${kindOf(e)}`}><IconBell size={15} /></div>
            <div className="feed-main">
              <div className="feed-text"><b>{t.title}</b></div>
              <div className="feed-time">{label(a, e.at)}</div>
            </div>
            <div className="feed-actions">
              {!a && <button className="iconbtn sm" title="Complete" aria-label="Complete" onClick={() => complete(t)}><IconCheck size={15} /></button>}
              {!a && <button className="iconbtn sm" title="Snooze 1 hour" aria-label="Snooze 1 hour" onClick={() => snooze(t)}><IconClock size={15} /></button>}
              {a === 'done' && <button className="undo-btn sm-undo" title="Undo complete" onClick={() => undoComplete(t)}>Undo</button>}
              {a === 'snoozed' && <button className="undo-btn sm-undo" title="Undo snooze" onClick={() => undoSnooze(t)}>Undo</button>}
              <button className="iconbtn sm danger-hover" title="Dismiss" aria-label="Dismiss reminder" onClick={() => dismiss(t.id)}><IconX size={15} /></button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
