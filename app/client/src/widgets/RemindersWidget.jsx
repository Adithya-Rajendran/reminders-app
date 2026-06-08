import React, { useCallback, useRef, useState } from 'react'
import { tk } from '../api.js'
import { useTaskList } from '../useTasks.js'
import { createTask, dueChip, timeLabel, ZERO_DATE } from '../tasklib.js'
import { emitTasksChanged } from '../tasksbus.js'
import TaskRow from './TaskRow.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconBell, IconClock, IconPlus } from '../icons.jsx'

function nextRemind(t) {
  const times = (t.reminders || []).map((r) => new Date(r.reminder).getTime()).filter((n) => !isNaN(n))
  return times.length ? Math.min(...times) : Infinity
}
// A sensible default reminder time: ~1 hour out, rounded to the next 5 minutes.
function defaultWhen() {
  const d = new Date(Date.now() + 3600e3)
  d.setSeconds(0, 0)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5)
  return d.toISOString()
}

// Your reminders — open tasks that have a reminder, soonest first, PLUS a quick-add
// so you can jot new reminders like a to-do list (type it, pick when, add). A row
// pulses when its reminder fires live over SSE.
export default function RemindersWidget({ events, projects }) {
  const inboxId = projects?.[0]?.id
  const loader = useCallback(async () => {
    const all = await tk('/tasks?per_page=200')
    return (Array.isArray(all) ? all : [])
      .filter((t) => !t.done && (t.reminders || []).length > 0)
      .sort((a, b) => nextRemind(a) - nextRemind(b))
  }, [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(loader)

  const [draft, setDraft] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [pickOpen, setPickOpen] = useState(false)
  const [err, setErr] = useState('')
  const whenRef = useRef(null)

  const add = async (e) => {
    e.preventDefault()
    const title = draft.trim()
    if (!title || !inboxId) return
    setErr('')
    setDraft('')
    try {
      await createTask(inboxId, { title, due_date: when, reminders: [{ reminder: when }] })
      setWhen(defaultWhen())
      emitTasksChanged()
      load()
    } catch (e2) {
      setDraft(title) // restore so the user doesn't lose their text
      let msg = 'Could not add reminder.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  // Task ids whose reminder/overdue alert fired recently — for a live "now" pulse.
  const fired = new Set()
  ;(events || []).forEach((e) => {
    const ev = e?.data?.event
    const t = ev?.data?.task
    if (t && /reminder|overdue/i.test(ev?.event_name || '')) fired.add(t.id)
  })

  const chip = dueChip(when)
  const t = timeLabel(when)

  return (
    <div className="tasklist">
      {inboxId ? (
        <form className="add-row qa rem-add" onSubmit={add}>
          <IconBell size={16} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Remind me to…" aria-label="Add a reminder" />
          <span className="inline-ctl">
            <button type="button" ref={whenRef} className="chip due-chip due-soon" aria-haspopup="dialog" title="When to remind me" onClick={() => setPickOpen((o) => !o)}>
              <IconClock size={12} /> {chip ? chip.label : 'When'}{t ? ' · ' + t : ''}
            </button>
            {pickOpen && (
              <DateTimePicker
                anchorRef={whenRef}
                value={when}
                hasReminder
                onApply={({ due_date }) => { if (due_date && due_date !== ZERO_DATE) setWhen(due_date); setPickOpen(false) }}
                onClose={() => setPickOpen(false)}
              />
            )}
          </span>
          <button type="submit" className="iconbtn sm" aria-label="Add reminder" title="Add reminder"><IconPlus size={16} /></button>
        </form>
      ) : null}
      {err && <div role="alert" className="rem-err">{err}</div>}

      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && <ErrorState onRetry={load} />}
      {state === 'ready' && (tasks.length === 0
        ? <EmptyState icon={IconBell} title="No reminders yet" sub={inboxId ? 'Type one above, pick a time, and hit +.' : 'Connect a CalDAV account with a writable list in Settings to add reminders.'} />
        : <div className="task-stream">
            {tasks.map((tk2) => (
              <div key={tk2.id} className={fired.has(tk2.id) ? 'reminding' : ''}>
                <TaskRow task={tk2} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
              </div>
            ))}
          </div>)}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
