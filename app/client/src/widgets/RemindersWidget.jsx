import React, { useState } from 'react'
import { updateTask } from '../tasklib.js'
import { IconBell, IconCheck, IconClock } from '../icons.jsx'

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

// Live, actionable reminders feed — each fired reminder can be completed or snoozed.
export default function RemindersWidget({ events }) {
  const [acted, setActed] = useState({})
  const items = (events || []).filter((e) => taskOf(e))

  const complete = async (t) => { setActed((a) => ({ ...a, [t.id]: 'done' })); try { await updateTask(t.id, { done: true }) } catch { /* */ } }
  const snooze = async (t) => {
    setActed((a) => ({ ...a, [t.id]: 'snoozed' }))
    const iso = new Date(Date.now() + 3600e3).toISOString()
    try { await updateTask(t.id, { reminders: [{ reminder: iso }] }) } catch { /* */ }
  }

  if (items.length === 0) {
    return (
      <div className="state">
        <div className="state-ic"><IconBell size={22} /></div>
        <div className="state-title">No reminders yet</div>
        <div className="state-sub">Fired reminders &amp; overdue alerts stream in here live — complete or snooze them right here.</div>
      </div>
    )
  }

  return (
    <div className="feed">
      {items.map((e, i) => {
        const t = taskOf(e)
        const a = acted[t.id]
        return (
          <div className={`feed-item${a ? ' acted' : ''}`} key={i}>
            <div className={`feed-ic ${kindOf(e)}`}><IconBell size={15} /></div>
            <div className="feed-main">
              <div className="feed-text"><b>{t.title}</b></div>
              <div className="feed-time">{a === 'done' ? 'Completed ✓' : a === 'snoozed' ? 'Snoozed 1h' : rel(e.at)}</div>
            </div>
            {!a && (
              <div className="feed-actions">
                <button className="iconbtn sm" title="Complete" aria-label="Complete" onClick={() => complete(t)}><IconCheck size={15} /></button>
                <button className="iconbtn sm" title="Snooze 1 hour" aria-label="Snooze 1 hour" onClick={() => snooze(t)}><IconClock size={15} /></button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
