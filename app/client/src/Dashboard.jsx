import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import { api, vk } from './api.js'
import TaskListWidget from './widgets/TaskListWidget.jsx'
import UpcomingWidget from './widgets/UpcomingWidget.jsx'
import RemindersWidget from './widgets/RemindersWidget.jsx'
import CaldavWidget from './widgets/CaldavWidget.jsx'
import CalendarWidget from './widgets/CalendarWidget.jsx'
import {
  IconPlus, IconChevDown, IconChevR, IconChevL,
  IconList, IconClock, IconBell, IconCloud, IconCalendar,
  IconGrip, IconX, IconInbox,
} from './icons.jsx'

const Grid = WidthProvider(Responsive)
const DASH = 'main'
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const TYPE_ICON = {
  tasklist: IconList,
  upcoming: IconClock,
  reminders: IconBell,
  caldav: IconCloud,
  calendar: IconCalendar,
}

const WIDGET_MENU = [
  { type: 'tasklist', label: 'Project task list', icon: IconList, hasSub: true },
  { type: 'upcoming', label: 'Upcoming', icon: IconClock },
  { type: 'reminders', label: 'Reminders feed', icon: IconBell },
  { type: 'caldav', label: 'CalDAV tasks', icon: IconCloud },
  { type: 'calendar', label: 'Calendar', icon: IconCalendar },
]

const newId = () => 'w-' + crypto.randomUUID()

/* close a popover on outside-click + Esc */
function usePopover(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return ref
}

export default function Dashboard({ user, onOpenSettings }) {
  const [projects, setProjects] = useState([])
  const [widgets, setWidgets] = useState([])
  const [layouts, setLayouts] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [events, setEvents] = useState([])
  const saveTimer = useRef(null)

  // Initial load: projects + saved layout (or a sensible default).
  useEffect(() => {
    (async () => {
      let pr = []
      try { pr = await vk('/projects') } catch { pr = [] }
      pr = Array.isArray(pr) ? pr.filter((p) => p.id > 0) : []
      setProjects(pr)

      let saved = null
      try { saved = await api('/api/layouts/' + DASH) } catch { /* none */ }
      if (saved?.layout) {
        // Any persisted layout is authoritative — including an intentionally empty one.
        setWidgets(saved.layout.widgets || [])
        setLayouts(saved.layout.layouts || {})
      } else {
        const def = []
        if (pr[0]) def.push({ i: newId(), type: 'tasklist', projectId: pr[0].id })
        def.push({ i: newId(), type: 'upcoming' })
        def.push({ i: newId(), type: 'reminders' })
        const lay = {}
        for (const bp of Object.keys(COLS)) {
          lay[bp] = def.map((w, idx) => ({ i: w.i, x: (idx * 4) % COLS[bp], y: 0, w: 4, h: 8 }))
        }
        setWidgets(def)
        setLayouts(lay)
      }
      setLoaded(true)
    })()
  }, [])

  // Live reminder/overdue events from the BFF (fed by Vikunja webhooks).
  // EventSource does NOT auto-reconnect after an HTTP error (e.g. 401), so we
  // reconnect manually; api('/api/me') redirects to login if the session expired.
  useEffect(() => {
    let es
    let timer
    let stopped = false
    const connect = () => {
      es = new EventSource('/api/events')
      es.addEventListener('vikunja', (e) => {
        let data = {}
        try { data = JSON.parse(e.data) } catch { /* ignore */ }
        setEvents((prev) => [{ at: Date.now(), data }, ...prev].slice(0, 50))
      })
      es.onerror = () => {
        if (stopped) return
        es.close()
        api('/api/me')
          .then(() => { timer = setTimeout(connect, 3000) })
          .catch(() => { timer = setTimeout(connect, 5000) })
      }
    }
    connect()
    return () => { stopped = true; clearTimeout(timer); if (es) es.close() }
  }, [])

  const persist = useCallback((nextWidgets, nextLayouts) => {
    if (!loaded) return // gate saves until after hydration (RGL footgun)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api('/api/layouts/' + DASH, {
        method: 'PUT',
        body: JSON.stringify({ layout: { version: 1, widgets: nextWidgets, layouts: nextLayouts } }),
      }).catch(() => {})
    }, 600)
  }, [loaded])

  const onLayoutChange = (_current, all) => {
    if (!loaded) return
    setLayouts(all)
    persist(widgets, all)
  }

  const addWidget = (type, projectId) => {
    const w = { i: newId(), type, projectId }
    const nextWidgets = [...widgets, w]
    const nextLayouts = { ...layouts }
    for (const bp of Object.keys(COLS)) {
      const items = nextLayouts[bp] || []
      // Place below existing items with a finite y (avoid persisting Infinity -> null).
      const y = items.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 0)), 0)
      nextLayouts[bp] = [...items, { i: w.i, x: 0, y, w: 4, h: 8 }]
    }
    setWidgets(nextWidgets)
    setLayouts(nextLayouts)
    persist(nextWidgets, nextLayouts)
  }

  const removeWidget = (id) => {
    const nextWidgets = widgets.filter((w) => w.i !== id)
    const nextLayouts = {}
    for (const bp of Object.keys(layouts)) nextLayouts[bp] = (layouts[bp] || []).filter((l) => l.i !== id)
    setWidgets(nextWidgets)
    setLayouts(nextLayouts)
    persist(nextWidgets, nextLayouts)
  }

  if (!loaded) {
    return (
      <div className="grid-wrap">
        <div
          className="glass"
          style={{ borderRadius: 'var(--r-card)', padding: '40px 24px', textAlign: 'center', maxWidth: 460, margin: '40px auto', color: 'var(--muted)' }}
        >
          Loading your dashboard…
        </div>
      </div>
    )
  }

  return (
    <>
      <Toolbar projects={projects} onAdd={addWidget} />
      <div className="grid-wrap">
        {widgets.length === 0 ? (
          <div
            className="glass"
            style={{ borderRadius: 'var(--r-card)', padding: '48px 24px', textAlign: 'center', maxWidth: 460, margin: '40px auto' }}
          >
            <div className="state-ic" style={{ margin: '0 auto 12px' }}><IconInbox size={22} /></div>
            <div className="state-title" style={{ fontSize: 16 }}>Your dashboard is empty</div>
            <div className="state-sub" style={{ margin: '6px auto 18px' }}>Add a widget to start assembling your workspace.</div>
            <AddWidgetMenu projects={projects} onAdd={addWidget} />
          </div>
        ) : (
          <Grid
            className="layout"
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={30}
            margin={[16, 16]}
            draggableHandle=".widget-grip"
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.i}>
                <WidgetFrame type={w.type} title={titleFor(w, projects)} onRemove={() => removeWidget(w.i)}>
                  {w.type === 'tasklist' && <TaskListWidget projectId={w.projectId} />}
                  {w.type === 'upcoming' && <UpcomingWidget />}
                  {w.type === 'reminders' && <RemindersWidget events={events} />}
                  {w.type === 'caldav' && <CaldavWidget />}
                  {w.type === 'calendar' && <CalendarWidget />}
                </WidgetFrame>
              </div>
            ))}
          </Grid>
        )}
      </div>
    </>
  )
}

/* ---------- Toolbar ---------- */
function Toolbar({ projects, onAdd }) {
  const now = new Date()
  const dateLabel = `${DOW_FULL[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
  return (
    <div className="toolbar">
      <div>
        <h1>Dashboard</h1>
        <div className="sub">{dateLabel}</div>
      </div>
      <div className="toolbar-spacer" />
      <AddWidgetMenu projects={projects} onAdd={onAdd} />
    </div>
  )
}

/* ---------- Add-widget dropdown (with project submenu) ---------- */
function AddWidgetMenu({ projects, onAdd }) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(false)
  const ref = usePopover(open, setOpen)
  useEffect(() => { if (!open) setSub(false) }, [open])

  const pick = (type, projectId) => { onAdd(type, projectId); setOpen(false) }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconPlus size={16} /> Add widget <IconChevDown size={14} style={{ marginLeft: -2, opacity: 0.85 }} />
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', animation: 'menuIn 150ms ease' }}
        >
          {!sub ? (
            <>
              <div className="menu-label">Add a widget</div>
              {WIDGET_MENU.map((m) => {
                const I = m.icon
                return (
                  <button
                    key={m.type}
                    className="menu-item"
                    role="menuitem"
                    onClick={() => (m.hasSub ? setSub(true) : pick(m.type))}
                    aria-haspopup={m.hasSub ? 'menu' : undefined}
                  >
                    <I size={16} /> {m.label}
                    {m.hasSub && <IconChevR size={15} className="chev" />}
                  </button>
                )
              })}
            </>
          ) : (
            <>
              <button className="menu-item" role="menuitem" onClick={() => setSub(false)} style={{ color: 'var(--muted)' }}>
                <IconChevL size={15} /> Project task list
              </button>
              <div className="menu-sep" />
              <div className="menu-label">Choose a project</div>
              {projects.length === 0 && (
                <div className="menu-label" style={{ textTransform: 'none', fontWeight: 500, color: 'var(--faint)' }}>
                  No projects yet
                </div>
              )}
              {projects.map((p) => (
                <button key={p.id} className="menu-item" role="menuitem" onClick={() => pick('tasklist', p.id)}>
                  <span className="pdot" style={{ background: p.hex_color || 'var(--accent)', width: 9, height: 9 }} /> {p.title}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Widget frame ---------- */
function WidgetFrame({ type, title, onRemove, children }) {
  const Ic = TYPE_ICON[type] || IconList
  return (
    <div className="widget">
      <div className="widget-head">
        <span
          className="widget-grip"
          title="Drag to move"
          aria-label="Drag to move widget"
          role="button"
          tabIndex={0}
        >
          <IconGrip size={16} />
        </span>
        <span className="widget-title">
          <Ic size={17} />
          <span className="t-text">{title}</span>
        </span>
        <span className="widget-head-actions">
          <button
            className="iconbtn sm danger-hover widget-remove"
            aria-label={`Remove ${title} widget`}
            title="Remove widget"
            onClick={onRemove}
          >
            <IconX size={15} />
          </button>
        </span>
      </div>
      <div className="widget-body">{children}</div>
    </div>
  )
}

function titleFor(w, projects) {
  if (w.type === 'upcoming') return 'Upcoming'
  if (w.type === 'reminders') return 'Reminders'
  if (w.type === 'caldav') return 'CalDAV Tasks'
  if (w.type === 'calendar') return 'Calendar'
  const p = projects.find((p) => p.id === w.projectId)
  return p ? p.title : 'Tasks'
}
