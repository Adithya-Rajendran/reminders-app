import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useTaskList, selectHabits, isRecurringTask, hasGroup, labelGroup, nextRemind,
  parseQuickAdd, dueChip, timeLabel, ZERO_DATE,
  useWidgetSize, atMostW, atLeastH, GroupPicker, TaskRow, DateTimePicker,
  SkeletonRows, EmptyState, ErrorState, UndoBar, widgetStore,
  IconBell, IconClock, IconPlus, IconChevR, IconFlame,
} from '../widget-sdk'

const COLLAPSE_KEY = 'reminders-collapsed-groups'

function defaultWhen() {
  const d = new Date(Date.now() + 3600e3); d.setSeconds(0, 0); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5); return d.toISOString()
}

// Your reminders. By default they're grouped into collapsible sections by tag
// (Work/Personal/…) with a quick-add. A group-locked widget (the `group` prop)
// shows only that group as a flat list and drops new reminders straight into it.
export default function RemindersWidget({ tasks: tasksCap, events, projects, groups: groupsCap, group, instanceId }) {
  const inboxId = projects?.[0]?.id
  // Derive from the shared task store (one /api/tasks fetch for the whole board).
  // We take the whole list and split it into a Habits section (recurring tasks,
  // shown with an inline consistency strip) and the reminder groups (non-recurring
  // tasks carrying a reminder) — so habits live here instead of a separate widget.
  const selector = useCallback((all) => all, [])
  const { tasks: allTasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const store = useMemo(() => widgetStore(instanceId), [instanceId])

  // Index tasks by UID and group subtasks under their parent (RELATED-TO ⇒
  // task.goal === parent.uid), so a parent reminder can show progress + nest its
  // children — the standalone Goals widget folded in here as plain subtasks.
  const byUid = useMemo(() => {
    const m = new Map()
    for (const t of allTasks) if (t.uid) m.set(t.uid, t)
    return m
  }, [allTasks])
  const childrenByParent = useMemo(() => {
    const m = new Map()
    for (const t of allTasks) {
      if (t.goal && byUid.has(t.goal)) { if (!m.has(t.goal)) m.set(t.goal, []); m.get(t.goal).push(t) }
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0)) // open first, done last
    return m
  }, [allTasks, byUid])
  const isChild = useCallback((t) => !!(t.goal && byUid.has(t.goal)), [byUid])

  // Top-level reminder rows: open, non-recurring, not a subtask, and either
  // carrying a reminder, parenting subtasks, or flagged as a goal (so goals show
  // here with their progress instead of in a separate widget). Soonest first.
  const reminders = useMemo(() => {
    let list = allTasks.filter((t) => !t.done && !isRecurringTask(t) && !isChild(t) && ((t.reminders || []).length > 0 || childrenByParent.has(t.uid) || t.is_goal))
    if (group) list = list.filter((t) => hasGroup(t, group))
    return list.sort((a, b) => nextRemind(a) - nextRemind(b))
  }, [allTasks, group, isChild, childrenByParent])
  const habits = useMemo(() => {
    let h = selectHabits(allTasks).filter((t) => !isChild(t))
    if (group) h = h.filter((t) => hasGroup(t, group))
    return h
  }, [allTasks, group, isChild])

  // Add a subtask under a parent reminder via RELATED-TO (goal_uid). Reuses the
  // NL quick-add parser so subtasks accept the same date/priority/label/cue tokens.
  const addSubtask = useCallback(async (parent, text) => {
    if (!inboxId || !parent?.uid) return
    const parsed = parseQuickAdd(text)
    if (!parsed.title) return
    try {
      await tasksCap.create(inboxId, {
        title: parsed.title,
        priority: parsed.priority || 0,
        ...(parsed.due_date ? { due_date: parsed.due_date } : {}),
        ...(parsed.labels?.length ? { labels: parsed.labels } : {}),
        ...(parsed.cue ? { cue: parsed.cue } : {}),
        goal_uid: parent.uid,
      })
      tasksCap.emitChanged(); load()
    } catch { /* the list refresh surfaces the result */ }
  }, [inboxId, load])

  const [draft, setDraft] = useState('')
  const [qaGroup, setQaGroup] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [pickOpen, setPickOpen] = useState(false)
  const [err, setErr] = useState('')
  const [knownGroups, setKnownGroups] = useState([])
  const [collapsed, setCollapsed] = useState(() => store.loadStringSet(COLLAPSE_KEY))
  const whenRef = useRef(null)

  // Narrow: trim the quick-add to one capture line (the group + time pickers don't
  // fit and have sensible defaults) and drop the collapsible section chrome for a
  // single flat stream. Tall: ignore the saved collapse state so everything's open.
  const sz = useWidgetSize()
  const compact = atMostW(sz, 'sm')
  const forceExpand = atLeastH(sz, 'lg')

  const toggleGroup = (key) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    store.saveStringSet(COLLAPSE_KEY, next)
    return next
  })

  // The real groups = those created in Settings (coupled to a calendar). A bare
  // tag with no calendar is the default group, so we load the set in both views to
  // fold uncoupled tags into "No group" (and hide their stray chips).
  const loadGroups = useCallback(() => {
    groupsCap.fetch().then((d) => setKnownGroups((d.groups || []).map((g) => g.name).filter(Boolean))).catch(() => {})
  }, [groupsCap])
  useEffect(() => { loadGroups() }, [loadGroups])
  useEffect(() => tasksCap.onChanged(loadGroups), [loadGroups, tasksCap])

  const add = async (e) => {
    e.preventDefault()
    const raw = draft.trim()
    if (!raw || !inboxId) return
    setErr(''); setDraft('')
    // Parse the same Quick-Add tokens subtasks already accept (date word, !priority,
    // *label, "-> cue") so capture is one keystroke-friendly line. A typed date wins
    // over the When picker; otherwise the picker time is used. Inline *labels merge
    // with the picked group (group first, so server group-routing still applies).
    const parsed = parseQuickAdd(raw)
    const title = parsed.title || raw
    const due = parsed.due_date || when
    const g = group || qaGroup.trim() // locked widget forces its group
    const labels = [...new Set([...(g ? [g] : []), ...(parsed.labels || [])])]
    try {
      await tasksCap.create(inboxId, {
        title,
        priority: parsed.priority || 0,
        due_date: due,
        reminders: [{ reminder: due }],
        ...(labels.length ? { labels } : {}),
        ...(parsed.cue ? { cue: parsed.cue } : {}),
      })
      if (g) groupsCap.pushRecent(g)
      setWhen(defaultWhen()); tasksCap.emitChanged(); load()
    } catch (e2) {
      setDraft(raw)
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
  const recent = groupsCap.recent().filter((g) => allGroups.includes(g))

  // Hide chips for tags that aren't real (coupled) groups so a stray tag doesn't
  // render as a label. Done once per task/groups change so rows keep stable
  // identity across unrelated re-renders (typing in quick-add no longer re-renders).
  const chipFilter = useCallback((task) => ({ ...task, labels: (task.labels || []).filter((l) => isGroup(l.title || l)) }), [isGroup])
  const shownTasks = useMemo(() => reminders.map((task) => ({ st: chipFilter(task), key: isGroup(labelGroup(task)) ? labelGroup(task) : '' })), [reminders, chipFilter, isGroup])
  const shownHabits = useMemo(() => habits.map(chipFilter), [habits, chipFilter])
  const groups = useMemo(() => {
    const g = {}
    for (const { st, key } of shownTasks) (g[key] ||= []).push(st)
    return g
  }, [shownTasks])

  const renderRow = (st, showHabit) => (
    <div key={st.id} className={fired.has(st.id) ? 'reminding' : ''}>
      <TaskRow task={st} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} showHabit={showHabit} childTasks={childrenByParent.get(st.uid)} onAddSubtask={addSubtask} />
    </div>
  )
  const renderSection = (key, title, items, showHabit) => {
    const isCol = !forceExpand && collapsed.has(key)
    return (
      <div key={key} className="rem-group-sec">
        <button type="button" className="group-head rem-head" aria-expanded={!isCol} title={isCol ? 'Expand section' : 'Minimize section'} onClick={() => toggleGroup(key)}>
          <IconChevR size={13} className={`rem-chev${isCol ? '' : ' open'}`} />
          <span className="g-title">{title}</span>
          <span className="g-count">{items.length}</span>
        </button>
        {!isCol && <div className="task-stream">{items.map((st) => renderRow(st, showHabit))}</div>}
      </div>
    )
  }
  // Recurring tasks surface as a Habits section (with an inline consistency strip)
  // above the reminder groups — the standalone Habits widget folded in here.
  const habitsSec = shownHabits.length ? renderSection('__habits', <><IconFlame size={13} /> Habits</>, shownHabits, true) : null
  const flatHabits = shownHabits.length ? <div className="task-stream">{shownHabits.map((st) => renderRow(st, true))}</div> : null

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (reminders.length === 0 && habits.length === 0) {
    body = <EmptyState icon={IconBell} title={group ? `No reminders in ${group}` : 'No reminders yet'} sub={inboxId ? (group ? 'Add one above.' : 'Type one above, pick a group and a time, and hit +.') : 'Connect a CalDAV account in Settings to add reminders.'} />
  } else if (compact) {
    // Narrow: one flat stream (habits then reminders), no section headers.
    body = <>{flatHabits}<div className="task-stream">{shownTasks.map(({ st }) => renderRow(st))}</div></>
  } else if (group) {
    body = <>{habitsSec}<div className="task-stream">{shownTasks.map(({ st }) => renderRow(st))}</div></> // locked → flat list
  } else {
    const groupKeys = Object.keys(groups).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    body = <>{habitsSec}{groupKeys.map((g) => renderSection(g || '__none', g || 'No group', groups[g], false))}</>
  }

  return (
    <div className="tasklist">
      {inboxId && (
        <form className="add-row qa rem-add" onSubmit={add}>
          <IconBell size={16} />
          <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={group ? `Add to ${group}…` : 'Remind me to…'} aria-label="Add a reminder" />
          {!group && !compact && (
            <GroupPicker
              value={qaGroup}
              groups={allGroups}
              recent={recent}
              onChange={setQaGroup}
              onNew={(name) => groupsCap.onNewGroup?.(name)}
              neutral={{ label: 'No group', value: '' }}
            />
          )}
          {!compact && (
            <span className="inline-ctl">
              <button type="button" ref={whenRef} className="chip due-chip due-soon" aria-haspopup="dialog" title="When to remind me" onClick={() => setPickOpen((o) => !o)}>
                <IconClock size={12} /> {chip ? chip.label : 'When'}{t ? ' · ' + t : ''}
              </button>
              {pickOpen && (
                <DateTimePicker anchorRef={whenRef} value={when} hasReminder onApply={({ due_date }) => { if (due_date && due_date !== ZERO_DATE) setWhen(due_date); setPickOpen(false) }} onClose={() => setPickOpen(false)} />
              )}
            </span>
          )}
          <button type="submit" className="iconbtn sm" aria-label="Add reminder" title="Add reminder"><IconPlus size={16} /></button>
        </form>
      )}
      {err && <div role="alert" className="rem-err">{err}</div>}
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
