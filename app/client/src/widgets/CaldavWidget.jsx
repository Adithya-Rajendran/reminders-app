import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { IconCloud, IconRefresh } from '../icons.jsx'

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
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  const n = dayDiff(dt)
  if (n < 0) return { label: relDay(dt), cls: 'overdue' }
  if (n <= 1) return { label: relDay(dt), cls: 'due-soon' }
  return { label: relDay(dt), cls: '' }
}

// CalDAV tasks carry no list color, so derive a stable one per source list.
const PALETTE = ['#6d6cf7', '#34d399', '#a855f7', '#fbbf24', '#f4577a']
function listColor(key) {
  const s = String(key || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
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
function EmptyState({ icon: Icon = IconCloud, title, sub }) {
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

export default function CaldavWidget() {
  const [tasks, setTasks] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error

  const load = async () => {
    try {
      const r = await api('/api/caldav/tasks')
      setTasks((r && r.tasks) || [])
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => { load() }, [])

  const reload = () => { setState('loading'); load() }

  const toggle = async (t) => {
    setTasks((prev) => prev.map((x) => (x.objectUrl === t.objectUrl ? { ...x, done: !x.done } : x)))
    try {
      await api('/api/caldav/tasks/toggle', {
        method: 'POST',
        body: JSON.stringify({ accountId: t.accountId, objectUrl: t.objectUrl, done: !t.done }),
      })
    } catch {
      load()
    }
  }

  // Body contents only — the dashboard's WidgetFrame provides the `.widget-body`.
  return (
    <>
      {state === 'loading' && <SkeletonRows n={5} />}
      {state === 'error' && <ErrorState onRetry={reload} />}
      {state === 'ready' && (
        tasks.length === 0 ? (
          <EmptyState
            icon={IconCloud}
            title="No synced tasks"
            sub="Enable a list in CalDAV Sync settings to pull tasks in."
          />
        ) : (
          tasks.map((t) => {
            const color = listColor(t.listName || t.accountId)
            const chip = dueChip(t.due)
            const source = [t.listName, t.accountName].filter(Boolean).join(' · ') || 'CalDAV'
            return (
              <div className={`cd-task${t.done ? ' checked' : ''}`} key={t.objectUrl}>
                <span className="cd-bar" style={{ background: color }} />
                <input
                  type="checkbox"
                  className="check"
                  checked={!!t.done}
                  onChange={() => toggle(t)}
                  aria-label={`Complete: ${t.summary}`}
                  style={{ marginTop: 1 }}
                />
                <div className="task-main">
                  <div
                    className="task-title"
                    style={t.done ? { color: 'var(--faint)', textDecoration: 'line-through' } : undefined}
                  >
                    <span className="t">{t.summary}</span>
                  </div>
                  <div className="task-sub">
                    <span className="source-tag">
                      <span className="sdot" style={{ background: color }} />
                      {source}
                    </span>
                    {chip && <span className={`chip ${chip.cls}`}>{chip.label}</span>}
                  </div>
                </div>
              </div>
            )
          })
        )
      )}
    </>
  )
}
