import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import { api, tk } from './api.js'
import UpcomingWidget from './widgets/UpcomingWidget.jsx'
import RemindersWidget from './widgets/RemindersWidget.jsx'
import CalendarWidget from './widgets/CalendarWidget.jsx'
import {
  IconPlus, IconChevDown,
  IconList, IconClock, IconBell, IconCalendar, IconCloud,
  IconX, IconInbox, IconRefresh,
} from './icons.jsx'

const Grid = WidthProvider(Responsive)
const DASH = 'main'
// Doubled columns (vs the old 12/10/6/4/2) so widgets resize in finer, ~half-column
// steps — on wide screens the old columns were too coarse. GRID_V bumps when this
// changes so older saved layouts get scaled to match.
const COLS = { lg: 24, md: 20, sm: 12, xs: 8, xxs: 4 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const GRID_V = 2
const W_DEFAULT = 8 // a default widget spans ~1/3 at lg (8 of 24)

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const TYPE_ICON = {
  upcoming: IconClock,
  reminders: IconBell,
  calendar: IconCalendar,
}
const KNOWN_TYPES = new Set(Object.keys(TYPE_ICON))

const WIDGET_MENU = [
  { type: 'reminders', label: 'Reminders', icon: IconBell },
  { type: 'upcoming', label: 'Upcoming', icon: IconClock },
  { type: 'calendar', label: 'Calendar', icon: IconCalendar },
]

const newId = () => 'w-' + crypto.randomUUID()

// A clean default dashboard: Reminders · Upcoming · Calendar.
function buildDefault() {
  const def = [
    { i: newId(), type: 'reminders' },
    { i: newId(), type: 'upcoming' },
    { i: newId(), type: 'calendar' },
  ]
  const lay = {}
  for (const bp of Object.keys(COLS)) lay[bp] = def.map((w, idx) => ({ i: w.i, x: (idx * W_DEFAULT) % COLS[bp], y: 0, w: W_DEFAULT, h: 9 }))
  return { widgets: def, layouts: lay }
}

// Scale a saved layout's x/w by a factor when the column count changes (heights
// are left alone). Used to upgrade old 12-column layouts to the new 24-column grid.
function scaleLayouts(layouts, f) {
  const out = {}
  for (const bp of Object.keys(layouts || {})) out[bp] = (layouts[bp] || []).map((it) => ({ ...it, x: Math.round((it.x || 0) * f), w: Math.max(2, Math.round((it.w || 1) * f)) }))
  return out
}

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
  const [caldavAccounts, setCaldavAccounts] = useState(null) // null until loaded
  const [widgets, setWidgets] = useState([])
  const [layouts, setLayouts] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [events, setEvents] = useState([])
  const saveTimer = useRef(null)

  // Initial load: projects + saved layout (or a sensible default).
  useEffect(() => {
    (async () => {
      let pr = []
      try { pr = await tk('/projects') } catch { pr = [] }
      pr = Array.isArray(pr) ? pr.filter((p) => p.id > 0) : []
      setProjects(pr)

      // How many CalDAV accounts are linked — drives the onboarding gate.
      let acctCount = 0
      try { const r = await api('/api/caldav/accounts'); acctCount = (r.accounts || []).length } catch { acctCount = 0 }
      setCaldavAccounts(acctCount)

      let saved = null
      try { saved = await api('/api/layouts/' + DASH) } catch { /* none */ }
      if (saved?.layout) {
        // Any persisted layout is authoritative — but drop retired widget types
        // (e.g. the old tasklist/caldav widgets), and scale a pre-24-column layout
        // up to the new grid. Persist whichever cleanup happened so it sticks.
        const original = saved.layout.widgets || []
        const sw = original.filter((w) => KNOWN_TYPES.has(w.type))
        let lay = saved.layout.layouts || {}
        const needsGrid = saved.layout.gridV !== GRID_V
        if (needsGrid) lay = scaleLayouts(lay, 2) // 12 → 24 columns
        setWidgets(sw)
        setLayouts(lay)
        if (sw.length !== original.length || needsGrid) {
          api('/api/layouts/' + DASH, {
            method: 'PUT',
            body: JSON.stringify({ layout: { version: 1, gridV: GRID_V, widgets: sw, layouts: lay } }),
          }).catch(() => {})
        }
      } else {
        const { widgets: def, layouts: lay } = buildDefault()
        setWidgets(def)
        setLayouts(lay)
      }
      setLoaded(true)
    })()
  }, [])

  // Live reminder/overdue events from the BFF (fed by the in-app scheduler).
  // EventSource does NOT auto-reconnect after an HTTP error (e.g. 401), so we
  // reconnect manually; api('/api/me') redirects to login if the session expired.
  useEffect(() => {
    let es
    let timer
    let stopped = false
    const connect = () => {
      es = new EventSource('/api/events')
      es.addEventListener('reminder', (e) => {
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
        body: JSON.stringify({ layout: { version: 1, gridV: GRID_V, widgets: nextWidgets, layouts: nextLayouts } }),
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
      nextLayouts[bp] = [...items, { i: w.i, x: 0, y, w: W_DEFAULT, h: 9 }]
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

  // Escape hatch for a cluttered/confusing board: back to the clean default.
  const resetLayout = () => {
    const { widgets: def, layouts: lay } = buildDefault()
    setWidgets(def)
    setLayouts(lay)
    persist(def, lay)
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

  // Onboarding: tasks live in the user's own CalDAV server, so with no account
  // linked there is nothing to show — prompt them to link one. (In every other
  // state at least an Inbox/list exists, so this only fires for a fresh user.)
  if (projects.length === 0 && caldavAccounts === 0) {
    return (
      <>
        <Toolbar projects={projects} onAdd={addWidget} />
        <OnboardingCard onOpenSettings={onOpenSettings} />
      </>
    )
  }

  return (
    <>
      <Toolbar projects={projects} onAdd={addWidget} onReset={resetLayout} />
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
            draggableHandle=".widget-head"
            draggableCancel="button,.iconbtn,.widget-head-actions"
            resizeHandles={['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne']}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.i}>
                <WidgetFrame type={w.type} title={titleFor(w)} onRemove={() => removeWidget(w.i)}>
                  {w.type === 'upcoming' && <UpcomingWidget />}
                  {w.type === 'reminders' && <RemindersWidget events={events} projects={projects} />}
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

/* ---------- Onboarding (no CalDAV account linked) ---------- */
function OnboardingCard({ onOpenSettings }) {
  return (
    <div className="grid-wrap">
      <div
        className="glass"
        style={{ borderRadius: 'var(--r-card)', padding: '48px 24px', textAlign: 'center', maxWidth: 480, margin: '40px auto' }}
      >
        <div className="state-ic" style={{ margin: '0 auto 14px' }}><IconCloud size={24} /></div>
        <div className="state-title" style={{ fontSize: 17 }}>Link a CalDAV account</div>
        <div className="state-sub" style={{ margin: '8px auto 20px', maxWidth: 360 }}>
          Your tasks &amp; reminders live in your own CalDAV server — Nextcloud, Apple iCloud, or any
          CalDAV provider. Connect an account to start adding tasks.
        </div>
        <button className="btn primary" onClick={onOpenSettings}>
          <IconCloud size={16} /> Connect CalDAV
        </button>
      </div>
    </div>
  )
}

/* ---------- Toolbar ---------- */
function Toolbar({ projects, onAdd, onReset }) {
  const now = new Date()
  const dateLabel = `${DOW_FULL[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
  return (
    <div className="toolbar">
      <div>
        <h1>Dashboard</h1>
        <div className="sub">{dateLabel}</div>
      </div>
      <div className="toolbar-spacer" />
      <AddWidgetMenu projects={projects} onAdd={onAdd} onReset={onReset} />
    </div>
  )
}

/* ---------- Add-widget dropdown ---------- */
function AddWidgetMenu({ onAdd, onReset }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  const pick = (type) => { onAdd(type); setOpen(false) }
  const reset = () => { onReset?.(); setOpen(false) }

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
          <div className="menu-label">Add a widget</div>
          {WIDGET_MENU.map((m) => {
            const I = m.icon
            return (
              <button key={m.type} className="menu-item" role="menuitem" onClick={() => pick(m.type)}>
                <I size={16} /> {m.label}
              </button>
            )
          })}
          {onReset && (
            <>
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" onClick={reset} style={{ color: 'var(--muted)' }}>
                <IconRefresh size={15} /> Reset layout
              </button>
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
      <div className="widget-head" title="Drag to move">
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

function titleFor(w) {
  if (w.type === 'upcoming') return 'Upcoming'
  if (w.type === 'calendar') return 'Calendar'
  return 'Reminders'
}
