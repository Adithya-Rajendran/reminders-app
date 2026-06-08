import React, { useCallback, useEffect, useRef, useState } from 'react'
import { tk } from '../api.js'
import { useTaskList } from '../useTasks.js'
import { createTask, dueChip, timeLabel, ZERO_DATE } from '../tasklib.js'
import { emitTasksChanged, onTasksChanged } from '../tasksbus.js'
import TaskRow from './TaskRow.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconBell, IconClock, IconPlus, IconChevR } from '../icons.jsx'

const COLLAPSE_KEY = 'reminders-collapsed-groups'
const loadCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')) } catch { return new Set() } }

function nextRemind(t) {
  const times = (t.reminders || []).map((r) => new Date(r.reminder).getTime()).filter((n) => !isNaN(n))
  return times.length ? Math.min(...times) : Infinity
}
// Default reminder time: ~1 hour out, rounded to the next 5 minutes.
function defaultWhen() {
  const d = new Date(Date.now() + 3600e3)
  d.setSeconds(0, 0)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5)
  return d.toISOString()
}
const groupOf = (t) => (t.labels && t.labels[0] && t.labels[0].title) || ''

// Your reminders, grouped into named groups (Work / Personal / …) via tags, with a
// quick-add so you can jot new ones like a to-do list (text + group + when). A row
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
  const [group, setGroup] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [pickOpen, setPickOpen] = useState(false)
  const [err, setErr] = useState('')
  const [knownGroups, setKnownGroups] = useState([])
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const whenRef = useRef(null)

  const toggleGroup = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })

  // Existing groups (CATEGORIES) for the autocomplete list.
  const loadGroups = useCallback(() => {
    tk('/labels').then((ls) => setKnownGroups((Array.isArray(ls) ? ls : []).map((l) => l.title).filter(Boolean))).catch(() => {})
  }, [])
  useEffect(() => { loadGroups() }, [loadGroups])
  useEffect(() => onTasksChanged(loadGroups), [loadGroups])

  const add = async (e) => {
    e.preventDefault()
    const title = draft.trim()
    if (!title || !inboxId) return
    setErr('')
    setDraft('')
    const g = group.trim()
    try {
      await createTask(inboxId, { title, due_date: when, reminders: [{ reminder: when }], ...(g ? { labels: [g] } : {}) })
      setWhen(defaultWhen())
      emitTasksChanged()
      load()
    } catch (e2) {
      setDraft(title)
      let msg = 'Could not add reminder.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  // Live "now" pulse for reminders/overdue that fired over SSE.
  const fired = new Set()
  ;(events || []).forEach((e) => {
    const ev = e?.data?.event
    const t = ev?.data?.task
    if (t && /reminder|overdue/i.test(ev?.event_name || '')) fired.add(t.id)
  })

  // Group the reminders; "" (no group) sorts last.
  const groups = {}
  for (const t of tasks) (groups[groupOf(t)] ||= []).push(t)
  const groupKeys = Object.keys(groups).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  const allGroups = [...new Set([...knownGroups, ...Object.keys(groups).filter(Boolean)])].sort()

  const chip = dueChip(when)
  const t = timeLabel(when)

  return (
    <div className="tasklist">
      {inboxId ? (
        <form className="add-row qa rem-add" onSubmit={add}>
          <IconBell size={16} />
          <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Remind me to…" aria-label="Add a reminder" />
          <input className="rem-group" list="rem-groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Group" aria-label="Group (optional)" />
          <datalist id="rem-groups">{allGroups.map((g) => <option key={g} value={g} />)}</datalist>
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
        ? <EmptyState icon={IconBell} title="No reminders yet" sub={inboxId ? 'Type one above, add a group like “Work”, pick a time, and hit +.' : 'Connect a CalDAV account in Settings to add reminders.'} />
        : groupKeys.map((g) => {
          const key = g || '__none'
          const isCol = collapsed.has(key)
          return (
            <div key={key} className="rem-group-sec">
              <button type="button" className="group-head rem-head" aria-expanded={!isCol} title={isCol ? 'Expand group' : 'Minimize group'} onClick={() => toggleGroup(key)}>
                <IconChevR size={13} className={`rem-chev${isCol ? '' : ' open'}`} />
                <span className="g-title">{g || 'No group'}</span>
                <span className="g-count">{groups[g].length}</span>
              </button>
              {!isCol && (
                <div className="task-stream">
                  {groups[g].map((task) => (
                    <div key={task.id} className={fired.has(task.id) ? 'reminding' : ''}>
                      <TaskRow task={task} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        }))}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
