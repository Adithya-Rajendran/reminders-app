import React, { useEffect, useState } from 'react'
import { vk } from '../api.js'
import { IconCheck, IconCloud, IconRefresh, IconClock } from '../icons.jsx'

const ZERO_DATE = '0001-01-01T00:00:00Z'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
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
        aria-label={`Complete: ${task.title}`}
        style={{ marginTop: 1 }}
      />
      <div className="task-main">
        <div className="task-title">
          {pd && <span className={`pdot ${pd}`} title={`Priority ${task.priority}`} />}
          <span className="t">{task.title}</span>
        </div>
        {chip && (
          <div className="task-sub">
            <span className={`chip ${chip.cls}`}><IconClock size={12} /> {chip.label}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function UpcomingWidget() {
  const [tasks, setTasks] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error

  const load = async () => {
    try {
      // All not-done tasks across projects, sorted by due date ascending.
      // (Vikunja 2.x: the cross-project list endpoint is /tasks, not /tasks/all.)
      const t = await vk('/tasks?sort_by=due_date&order_by=asc&per_page=100')
      const list = (Array.isArray(t) ? t : [])
        .filter((x) => !x.done && x.due_date && x.due_date !== ZERO_DATE)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      setTasks(list)
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [])

  const reload = () => { setState('loading'); load() }

  const toggle = async (t) => {
    setTasks((prev) => prev.filter((x) => x.id !== t.id))
    try {
      await vk(`/tasks/${t.id}`, { method: 'POST', body: JSON.stringify({ done: true }) })
    } catch {
      load()
    }
  }

  // group by Today / Tomorrow / This week
  const g = { today: [], tomorrow: [], week: [] }
  tasks.forEach((t) => {
    const n = dayDiff(new Date(t.due_date))
    if (n <= 0) g.today.push(t)
    else if (n === 1) g.tomorrow.push(t)
    else if (n <= 7) g.week.push(t)
  })
  const today = new Date()
  const tmr = addDays(today, 1)
  const sections = [
    { key: 'today', label: 'Today', date: `Today · ${MON[today.getMonth()]} ${today.getDate()}`, items: g.today },
    { key: 'tomorrow', label: 'Tomorrow', date: `${MON[tmr.getMonth()]} ${tmr.getDate()}`, items: g.tomorrow },
    { key: 'week', label: 'This week', date: 'Next 7 days', items: g.week },
  ].filter((s) => s.items.length)
  const total = sections.reduce((acc, s) => acc + s.items.length, 0)

  // Body contents only — the dashboard's WidgetFrame provides the `.widget-body`.
  return (
    <>
      {state === 'loading' && <SkeletonRows n={6} />}
      {state === 'error' && <ErrorState onRetry={reload} />}
      {state === 'ready' && (
        total === 0 ? (
          <EmptyState
            icon={IconCheck}
            title="Nothing scheduled"
            sub="Tasks with a due date in the next week will show up here."
          />
        ) : (
          sections.map((s) => (
            <div key={s.key}>
              <div className="group-head">
                <span className="g-title">{s.label}</span>
                <span className="g-date">{s.date}</span>
                <span className="g-count">{s.items.length}</span>
              </div>
              {s.items.map((t) => (
                <TaskRow key={t.id} task={t} onToggle={() => toggle(t)} />
              ))}
            </div>
          ))
        )
      )}
    </>
  )
}
