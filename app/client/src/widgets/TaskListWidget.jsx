import React, { useEffect, useRef, useState } from 'react'
import { vk } from '../api.js'
import { IconCheck, IconCloud, IconRefresh, IconClock, IconPlus } from '../icons.jsx'

const ZERO_DATE = '0001-01-01T00:00:00Z'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const dayDiff = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
function relDay(d) {
  const n = dayDiff(d)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n > 1 && n < 7) return DOW_FULL[new Date(d).getDay()]
  const dt = new Date(d)
  return `${MON[dt.getMonth()]} ${dt.getDate()}`
}
function dueChip(d) {
  if (!d) return null
  const n = dayDiff(d)
  if (n < 0) return { label: relDay(d), cls: 'overdue' }
  if (n <= 1) return { label: relDay(d), cls: 'due-soon' }
  return { label: relDay(d), cls: '' }
}

// Vikunja priority: higher number = more urgent. Map to the design's p1..p3 dots
// (p1 = danger/red is the most urgent visual).
function pdotClass(p) {
  if (p >= 4) return 'p1'
  if (p === 3) return 'p2'
  if (p === 2) return 'p3'
  return null
}

/* ---------- shared widget states ---------- */
function SkeletonRows({ n = 5 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="skel-task" key={i}>
          <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 6, flex: '0 0 auto' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skel-line" style={{ width: `${62 + (i * 13) % 30}%` }} />
            <div className="skeleton skel-line" style={{ width: `${30 + (i * 17) % 24}%`, marginTop: 7, height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
function EmptyState({ icon: Icon = IconCheck, title, sub }) {
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
      <div className="state-sub">{sub || 'The sync request failed. Check your connection and try again.'}</div>
      <button className="btn ghost sm" onClick={onRetry} style={{ marginTop: 4 }}>
        <IconRefresh size={14} /> Retry
      </button>
    </div>
  )
}

/* ---------- task row ---------- */
function TaskRow({ task, onToggle }) {
  const due = task.due_date && task.due_date !== ZERO_DATE ? new Date(task.due_date) : null
  const chip = dueChip(due)
  const pd = pdotClass(task.priority)
  return (
    <div className={`task${task.done ? ' checked' : ''}`}>
      <input
        type="checkbox"
        className="check"
        checked={!!task.done}
        onChange={onToggle}
        aria-label={`${task.done ? 'Mark incomplete' : 'Complete'}: ${task.title}`}
        style={{ marginTop: 1 }}
      />
      <div className="task-main">
        <div className="task-title">
          {pd && <span className={`pdot ${pd}`} title={`Priority ${task.priority}`} />}
          <span className="t">{task.title}</span>
        </div>
        {(task.done || chip) && (
          <div className="task-sub">
            {task.done
              ? <span className="chip done"><IconCheck size={12} /> Done</span>
              : <span className={`chip ${chip.cls}`}><IconClock size={12} /> {chip.label}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- inline add row ---------- */
function AddTaskRow({ onAdd, placeholder = 'Add a task…' }) {
  const [val, setVal] = useState('')
  const ref = useRef(null)
  const submit = () => { const v = val.trim(); if (v) { onAdd(v); setVal('') } }
  return (
    <div className="add-row" onClick={() => ref.current && ref.current.focus()}>
      <IconPlus size={16} />
      <input
        ref={ref}
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        onBlur={submit}
        aria-label="Add a task"
      />
    </div>
  )
}

export default function TaskListWidget({ projectId }) {
  const [tasks, setTasks] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error

  const load = async () => {
    if (!projectId) { setTasks([]); setState('ready'); return }
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      const t = await vk(`/projects/${projectId}/tasks?per_page=100`)
      setTasks(Array.isArray(t) ? t : [])
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => { load() }, [projectId])

  const reload = () => { setState('loading'); load() }

  const add = async (title) => {
    try {
      await vk(`/projects/${projectId}/tasks`, { method: 'PUT', body: JSON.stringify({ title }) })
      load()
    } catch {
      setState('error')
    }
  }

  const toggle = async (t) => {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
    try {
      await vk(`/tasks/${t.id}`, { method: 'POST', body: JSON.stringify({ done: !t.done }) })
    } catch {
      load()
    }
  }

  const sorted = [...tasks].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))

  // Body contents only — the dashboard's WidgetFrame provides the `.widget-body`
  // scroll container (so `.state` height:100% fills correctly; no double nesting).
  return (
    <>
      {state === 'loading' && <SkeletonRows n={5} />}
      {state === 'error' && <ErrorState onRetry={reload} />}
      {state === 'ready' && (
        tasks.length === 0 ? (
          <EmptyState
            icon={IconCheck}
            title="All clear"
            sub="No tasks in this project yet. Add one below to get started."
          />
        ) : (
          <>
            {sorted.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={() => toggle(t)} />
            ))}
            <AddTaskRow onAdd={add} placeholder="Add a task…" />
          </>
        )
      )}
    </>
  )
}
