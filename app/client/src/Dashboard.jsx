import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import { api, tk } from './api.js'
import { WIDGETS, WIDGET_TYPES, DEFAULT_BOARD } from './widgets/registry.jsx'
import { SkeletonRows } from './widgets/parts.jsx'
import {
  COLS, BREAKPOINTS, GRID_V, SCALE_TO_CURRENT, DEFAULT_SIZE,
  scaleLayouts, defaultLayouts, appendToLayouts, fillBreakpoints,
} from './dashlayout.js'
import { usePopover } from './usePopover.js'
import WidgetBoundary from './widgets/WidgetBoundary.jsx'
import { GroupList } from './GroupPicker.jsx'
import { recentGroups } from './groups.js'
import {
  IconPlus, IconChevDown, IconChevR, IconChevL,
  IconList, IconBell, IconCloud,
  IconX, IconInbox, IconRefresh,
} from './icons.jsx'

const Grid = WidthProvider(Responsive)

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const sizeFor = (type) => ({ ...DEFAULT_SIZE, ...(WIDGET_TYPES.get(type)?.defaultSize || {}) })

const newId = () => 'w-' + crypto.randomUUID()

// A clean default dashboard (DEFAULT_BOARD in the registry), placed left to right.
function buildDefault() {
  const def = DEFAULT_BOARD.map((type) => ({ i: newId(), type }))
  return { widgets: def, layouts: defaultLayouts(def, sizeFor) }
}

export default function Dashboard({ onOpenSettings, dashboardId = 'main', title }) {
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
      // The three boot fetches are independent — run them concurrently instead
      // of paying three sequential round-trips before the grid can render.
      const [prR, acctR, savedR] = await Promise.allSettled([
        tk('/projects'),
        api('/api/caldav/accounts'),
        api('/api/layouts/' + dashboardId),
      ])
      let pr = prR.status === 'fulfilled' ? prR.value : []
      pr = Array.isArray(pr) ? pr.filter((p) => p.id > 0) : []
      setProjects(pr)

      // How many CalDAV accounts are linked — drives the onboarding gate.
      const acctCount = acctR.status === 'fulfilled' ? (acctR.value?.accounts || []).length : 0
      setCaldavAccounts(acctCount)

      const saved = savedR.status === 'fulfilled' ? savedR.value : null
      if (saved?.layout) {
        // Any persisted layout is authoritative — but drop retired widget types
        // (e.g. the old tasklist/caldav widgets), and scale a pre-24-column layout
        // up to the new grid. Persist whichever cleanup happened so it sticks.
        const original = saved.layout.widgets || []
        const sw = original.filter((w) => WIDGET_TYPES.has(w.type))
        const storedV = saved.layout.gridV || 1
        let lay = saved.layout.layouts || {}
        const f = SCALE_TO_CURRENT[storedV] ?? 2.5
        const needsGrid = f !== 1
        if (needsGrid) lay = scaleLayouts(lay, f)
        // Boards stamped before gridV 4 may carry the old ultrawide tiers that
        // scaled widgets proportionally (so they grew on wide screens). Drop those
        // tiers — keeping the base layout (lg…xxs) — so fillBreakpoints rebuilds
        // them at constant widget size. Runs once: the PUT below stamps GRID_V.
        const staleWide = storedV < 4
        if (staleWide) { lay = { ...lay }; for (const bp of ['xl', 'xxl', 'xxxl', 'xxxxl']) delete lay[bp] }
        // Fill in any breakpoints the saved board lacks (e.g. the ultrawide tiers
        // on a board that predates them) so a wide canvas shows a full layout, not
        // a top-left cluster. Persist below so the fill sticks (idempotent after).
        const before = Object.keys(lay).length
        lay = fillBreakpoints(lay)
        const addedBp = Object.keys(lay).length !== before
        setWidgets(sw)
        setLayouts(lay)
        if (sw.length !== original.length || needsGrid || addedBp || staleWide) {
          api('/api/layouts/' + dashboardId, {
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
      api('/api/layouts/' + dashboardId, {
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

  const addWidget = (type, group) => {
    // For a group-aware widget (registry pickGroup), `group` locks it to one
    // group (null = all groups).
    const w = { i: newId(), type, group: group || undefined }
    const nextWidgets = [...widgets, w]
    const nextLayouts = appendToLayouts(layouts, w.i, sizeFor(type))
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

  // Group creation happens only in Settings now — open it with the typed name.
  const onNewGroup = (name) => onOpenSettings?.({ createGroup: name })

  // Shared context handed to every widget's render() (see widgets/registry.jsx).
  const widgetCtx = { events, projects, onNewGroup, onOpenSettings }

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
        <Toolbar projects={projects} onAdd={addWidget} onNewGroup={onNewGroup} title={title} />
        <OnboardingCard onOpenSettings={onOpenSettings} />
      </>
    )
  }

  return (
    <>
      <Toolbar projects={projects} onAdd={addWidget} onReset={resetLayout} onNewGroup={onNewGroup} title={title} />
      <div className="grid-wrap">
        {widgets.length === 0 ? (
          <div
            className="glass"
            style={{ borderRadius: 'var(--r-card)', padding: '48px 24px', textAlign: 'center', maxWidth: 460, margin: '40px auto' }}
          >
            <div className="state-ic" style={{ margin: '0 auto 12px' }}><IconInbox size={22} /></div>
            <div className="state-title" style={{ fontSize: 16 }}>Your dashboard is empty</div>
            <div className="state-sub" style={{ margin: '6px auto 18px' }}>Add a widget to start assembling your workspace.</div>
            <AddWidgetMenu projects={projects} onAdd={addWidget} onNewGroup={onNewGroup} />
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
                  {WIDGET_TYPES.get(w.type)?.render(w, widgetCtx)}
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
function Toolbar({ projects, onAdd, onReset, onNewGroup, title }) {
  const now = new Date()
  const dateLabel = `${DOW_FULL[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
  return (
    <div className="toolbar">
      <div>
        <h1>{title || 'Dashboard'}</h1>
        <div className="sub">{dateLabel}</div>
      </div>
      <div className="toolbar-spacer" />
      <AddWidgetMenu projects={projects} onAdd={onAdd} onReset={onReset} onNewGroup={onNewGroup} />
    </div>
  )
}

/* ---------- Add-widget dropdown (pickGroup widgets get a group submenu) ---------- */
function AddWidgetMenu({ onAdd, onReset, onNewGroup }) {
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState(false)   // false | a pickGroup widget type
  const [groups, setGroups] = useState([])
  const ref = usePopover(open, setOpen)
  useEffect(() => { if (!open) setSub(false) }, [open])
  useEffect(() => {
    if (!sub) return
    api('/api/reminder-groups').then((d) => setGroups((d.groups || []).map((g) => g.name).filter(Boolean))).catch(() => {})
  }, [sub])

  const add = (type, group) => { onAdd(type, group); setOpen(false) }
  const reset = () => { onReset?.(); setOpen(false) }
  const recent = recentGroups().filter((g) => groups.includes(g))

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconPlus size={16} /> Add widget <IconChevDown size={14} style={{ marginLeft: -2, opacity: 0.85 }} />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', animation: 'menuIn 150ms ease' }}>
          {!sub ? (
            <>
              <div className="menu-label">Add a widget</div>
              {WIDGETS.map((m) => {
                const I = m.icon
                return (
                  <button key={m.type} className="menu-item" role="menuitem" onClick={() => (m.pickGroup ? setSub(m.type) : add(m.type))} aria-haspopup={m.pickGroup ? 'menu' : undefined}>
                    <I size={16} /> {m.label}{m.pickGroup && <IconChevR size={15} className="chev" />}
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
            </>
          ) : (
            <>
              <button className="menu-item" role="menuitem" onClick={() => setSub(false)} style={{ color: 'var(--muted)' }}>
                <IconChevL size={15} /> {WIDGET_TYPES.get(sub)?.label || 'Back'}
              </button>
              <div className="menu-sep" />
              <div className="menu-label">Lock to which group?</div>
              <GroupList
                groups={groups}
                recent={recent}
                neutral={{ label: 'All groups', value: '', icon: IconBell }}
                onPick={(v) => add(sub, v || null)}
                onNew={(name) => { setOpen(false); onNewGroup?.(name) }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- Widget frame ---------- */
function WidgetFrame({ type, title, onRemove, children }) {
  const Ic = WIDGET_TYPES.get(type)?.icon || IconList
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
      <div className="widget-body">
        {/* widgets are lazy (see registry.jsx) — skeleton while a chunk loads, and a
            boundary so a failed chunk/render can't blank the whole board */}
        <WidgetBoundary>
          <Suspense fallback={<SkeletonRows n={4} />}>{children}</Suspense>
        </WidgetBoundary>
      </div>
    </div>
  )
}

function titleFor(w) {
  const spec = WIDGET_TYPES.get(w.type)
  if (!spec) return w.type
  return spec.title ? spec.title(w) : spec.label
}
