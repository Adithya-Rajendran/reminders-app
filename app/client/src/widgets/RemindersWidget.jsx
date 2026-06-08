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
function defaultWhen() {
  const d = new Date(Date.now() + 3600e3); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5); return d.toISOString()
}
const groupOf = (t) => (t.labels && t.labels[0] && t.labels[0].title) || ''
const hasGroup = (t, g) => (t.labels || []).some((l) => (l.title || '') === g)

// Your reminders. By default they're grouped into collapsible sections by tag
// (Work/Personal/…) with a quick-add. A group-locked widget (the `group` prop)
// shows only that group as a flat list and drops new reminders straight into it.
export default function RemindersWidget({ events, projects, group }) {
  const inboxId = projects?.[0]?.id
  const loader = useCallback(async () => {
    const all = await tk('/tasks?per_page=200')
    let list = (Array.isArray(all) ? all : []).filter((t) => !t.done && (t.reminders || []).length > 0)
    if (group) list = list.filter((t) => hasGroup(t, group))
    return list.sort((a, b) => nextRemind(a) - nextRemind(b))
  }, [group])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(loader)

  const [draft, setDraft] = useState('')
  const [qaGroup, setQaGroup] = useState('')
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

  // Existing groups for the quick-add autocomplete (only the all-groups view).
  const loadGroups = useCallback(() => {
    tk('/labels').then((ls) => setKnownGroups((Array.isArray(ls) ? ls : []).map((l) => l.title).filter(Boolean))).catch(() => {})
  }, [])
  useEffect(() => { if (!group) loadGroups() }, [group, loadGroups])
  useEffect(() => (group ? undefined : onTasksChanged(loadGroups)), [group, loadGroups])

  const add = async (e) => {
    e.preventDefault()
    const title = draft.trim()
    if (!title || !inboxId) return
    setErr(''); setDraft('')
    const g = group || qaGroup.trim() // locked widget forces its group
    try {
      await createTask(inboxId, { title, due_date: when, reminders: [{ reminder: when }], ...(g ? { labels: [g] } : {}) })
      setWhen(defaultWhen()); emitTasksChanged(); load()
    } catch (e2) {
      setDraft(title)
      let msg = 'Could not add reminder.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  const fired = new Set()
  ;(events || []).forEach((e) => { const ev = e?.data?.event; const t = ev?.data?.task; if (t && /reminder|overdue/i.test(ev?.event_name || '')) fired.add(t.id) })

  const chip = dueChip(when); const t = timeLabel(when)
  const allGroups = [...new Set([...knownGroups, ...tasks.map(groupOf).filter(Boolean)])].sort()

  const row = (task) => (
    <div key={task.id} className={fired.has(task.id) ? 'reminding' : ''}>
      <TaskRow task={task} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
    </div>
  )

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (tasks.length === 0) {
    body = <EmptyState icon={IconBell} title={group ? `No reminders in ${group}` : 'No reminders yet'} sub={inboxId ? (group ? 'Add one above.' : 'Type one above, add a group like “Work”, pick a time, and hit +.') : 'Connect a CalDAV account in Settings to add reminders.'} />
  } else if (group) {
    body = <div className="task-stream">{tasks.map(row)}</div> // locked → flat list
  } else {
    const groups = {}
    for (const task of tasks) (groups[groupOf(task)] ||= []).push(task)
    const groupKeys = Object.keys(groups).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    body = groupKeys.map((g) => {
      const key = g || '__none'; const isCol = collapsed.has(key)
      return (
        <div key={key} className="rem-group-sec">
          <button type="button" className="group-head rem-head" aria-expanded={!isCol} title={isCol ? 'Expand group' : 'Minimize group'} onClick={() => toggleGroup(key)}>
            <IconChevR size={13} className={`rem-chev${isCol ? '' : ' open'}`} />
            <span className="g-title">{g || 'No group'}</span>
            <span className="g-count">{groups[g].length}</span>
          </button>
          {!isCol && <div className="task-stream">{groups[g].map(row)}</div>}
        </div>
      )
    })
  }

  return (
    <div className="tasklist">
      {inboxId && (
        <form className="add-row qa rem-add" onSubmit={add}>
          <IconBell size={16} />
          <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={group ? `Add to ${group}…` : 'Remind me to…'} aria-label="Add a reminder" />
          {!group && <input className="rem-group" list="rem-groups" value={qaGroup} onChange={(e) => setQaGroup(e.target.value)} placeholder="Group" aria-label="Group (optional)" />}
          {!group && <datalist id="rem-groups">{allGroups.map((g) => <option key={g} value={g} />)}</datalist>}
          <span className="inline-ctl">
            <button type="button" ref={whenRef} className="chip due-chip due-soon" aria-haspopup="dialog" title="When to remind me" onClick={() => setPickOpen((o) => !o)}>
              <IconClock size={12} /> {chip ? chip.label : 'When'}{t ? ' · ' + t : ''}
            </button>
            {pickOpen && (
              <DateTimePicker anchorRef={whenRef} value={when} hasReminder onApply={({ due_date }) => { if (due_date && due_date !== ZERO_DATE) setWhen(due_date); setPickOpen(false) }} onClose={() => setPickOpen(false)} />
            )}
          </span>
          <button type="submit" className="iconbtn sm" aria-label="Add reminder" title="Add reminder"><IconPlus size={16} /></button>
        </form>
      )}
      {err && <div role="alert" className="rem-err">{err}</div>}
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
