import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { reminderGroups } from '../api.js'
import { useTaskList } from '../useTasks.js'
import { selectReminders, labelGroup } from '../taskviews.js'
import { createTask, dueChip, timeLabel, ZERO_DATE } from '../tasklib.js'
import { emitTasksChanged, onTasksChanged } from '../tasksbus.js'
import { recentGroups, pushRecentGroup } from '../groups.js'
import GroupPicker from '../GroupPicker.jsx'
import TaskRow from './TaskRow.jsx'
import DateTimePicker from './DateTimePicker.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { loadStringSet, saveStringSet } from '../storage.js'
import { IconBell, IconClock, IconPlus, IconChevR } from '../icons.jsx'

const COLLAPSE_KEY = 'reminders-collapsed-groups'

function defaultWhen() {
  const d = new Date(Date.now() + 3600e3); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5); return d.toISOString()
}

// Your reminders. By default they're grouped into collapsible sections by tag
// (Work/Personal/…) with a quick-add. A group-locked widget (the `group` prop)
// shows only that group as a flat list and drops new reminders straight into it.
export default function RemindersWidget({ events, projects, group, onNewGroup }) {
  const inboxId = projects?.[0]?.id
  // Derive from the shared task store (one /api/tasks fetch for the whole board).
  const selector = useCallback((all) => selectReminders(all, group), [group])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(selector)

  const [draft, setDraft] = useState('')
  const [qaGroup, setQaGroup] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [pickOpen, setPickOpen] = useState(false)
  const [err, setErr] = useState('')
  const [knownGroups, setKnownGroups] = useState([])
  const [collapsed, setCollapsed] = useState(() => loadStringSet(COLLAPSE_KEY))
  const whenRef = useRef(null)

  const toggleGroup = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    saveStringSet(COLLAPSE_KEY, next)
    return next
  })

  // The real groups = those created in Settings (coupled to a calendar). A bare
  // tag with no calendar is the default group, so we load the set in both views to
  // fold uncoupled tags into "No group" (and hide their stray chips).
  const loadGroups = useCallback(() => {
    reminderGroups().then((d) => setKnownGroups((d.groups || []).map((g) => g.name).filter(Boolean))).catch(() => {})
  }, [])
  useEffect(() => { loadGroups() }, [loadGroups])
  useEffect(() => onTasksChanged(loadGroups), [loadGroups])

  const add = async (e) => {
    e.preventDefault()
    const title = draft.trim()
    if (!title || !inboxId) return
    setErr(''); setDraft('')
    const g = group || qaGroup.trim() // locked widget forces its group
    try {
      await createTask(inboxId, { title, due_date: when, reminders: [{ reminder: when }], ...(g ? { labels: [g] } : {}) })
      if (g) pushRecentGroup(g)
      setWhen(defaultWhen()); emitTasksChanged(); load()
    } catch (e2) {
      setDraft(title)
      let msg = 'Could not add reminder.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  // Reminders the SSE feed has already fired, so the matching rows can flash.
  const fired = useMemo(() => {
    const s = new Set()
    ;(events || []).forEach((e) => { const ev = e?.data?.event; const t = ev?.data?.task; if (t && /reminder|overdue/i.test(ev?.event_name || '')) s.add(t.id) })
    return s
  }, [events])

  const chip = dueChip(when); const t = timeLabel(when)
  // Only calendar-coupled groups count; uncoupled tags fold into the default group.
  const isGroup = useCallback((name) => knownGroups.includes(name), [knownGroups])
  const allGroups = [...knownGroups].sort()
  const recent = recentGroups().filter((g) => allGroups.includes(g))

  // Pre-filter chips (hide tags that aren't real, coupled groups) and bucket by
  // group ONCE per task/groups change, so rows keep stable identity across
  // unrelated re-renders (typing in the quick-add box no longer re-renders rows).
  // The handlers don't read labels, so passing the chip-filtered copy is safe.
  const shownTasks = useMemo(() => tasks.map((task) => {
    const raw = labelGroup(task)
    return {
      st: { ...task, labels: (task.labels || []).filter((l) => isGroup(l.title || l)) },
      key: isGroup(raw) ? raw : '',
    }
  }), [tasks, isGroup])
  const groups = useMemo(() => {
    const g = {}
    for (const { st, key } of shownTasks) (g[key] ||= []).push(st)
    return g
  }, [shownTasks])

  const renderRow = (st) => (
    <div key={st.id} className={fired.has(st.id) ? 'reminding' : ''}>
      <TaskRow task={st} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} />
    </div>
  )

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (tasks.length === 0) {
    body = <EmptyState icon={IconBell} title={group ? `No reminders in ${group}` : 'No reminders yet'} sub={inboxId ? (group ? 'Add one above.' : 'Type one above, pick a group and a time, and hit +.') : 'Connect a CalDAV account in Settings to add reminders.'} />
  } else if (group) {
    body = <div className="task-stream">{shownTasks.map(({ st }) => renderRow(st))}</div> // locked → flat list
  } else {
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
          {!isCol && <div className="task-stream">{groups[g].map(renderRow)}</div>}
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
          {!group && (
            <GroupPicker
              value={qaGroup}
              groups={allGroups}
              recent={recent}
              onChange={setQaGroup}
              onNew={(name) => onNewGroup?.(name)}
              neutral={{ label: 'No group', value: '' }}
            />
          )}
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
