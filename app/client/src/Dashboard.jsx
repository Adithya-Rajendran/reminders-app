import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import { api, tk, reminderGroups, notesApi } from './api.js'
import { subscribe, getTasks, getState, refresh, ensureLoaded, patchTask, removeTask, replaceTasks, insertTask } from './taskstore.js'
import { updateTask, createTask, deleteTask, attachLabels, isRealDate } from './tasklib.js'
import { emitTasksChanged, onTasksChanged } from './tasksbus.js'
import { onOpenNote, emitOpenNote } from './notesbus.js'
import { WIDGETS, WIDGET_TYPES, DEFAULT_BOARD } from './widgets/registry.jsx'
import { resolveConnections, selectCtx, appSlots, describeConnections } from './connections.js'
import { SkeletonRows, UndoBar } from './widget-sdk'
import {
  COLS, BREAKPOINTS, GRID_V, SCALE_TO_CURRENT, DEFAULT_SIZE,
  scaleLayouts, defaultLayouts, appendToLayouts, fillBreakpoints, applyConstraints, clampAspect,
} from './dashlayout.js'
import { useElementSize, WidgetSizeContext } from './useWidgetSize.js'
import { usePopover } from './usePopover.js'
import WidgetBoundary from './widgets/WidgetBoundary.jsx'
import { GroupList } from './widget-sdk'
import { recentGroups, pushRecentGroup } from './groups.js'
import {
  IconPlus, IconChevDown, IconChevR, IconChevL,
  IconList, IconBell, IconCloud,
  IconX, IconInbox, IconRefresh,
} from './icons.jsx'

const Grid = WidthProvider(Responsive)

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Capability prerequisites a widget may declare (manifest.requires) that the host
// can determine and gate on. Others (e.g. nextcloud) a widget self-handles.
const KNOWABLE_REQUIREMENTS = new Set(['caldav'])
const REQUIREMENT_LABEL = { caldav: 'a CalDAV account', nextcloud: 'a Nextcloud account' }

const sizeFor = (type) => ({ ...DEFAULT_SIZE, ...(WIDGET_TYPES.get(type)?.defaultSize || {}) })

// The per-widget size contract the host enforces (Wayland/ICCCM-style hints): a
// floor (Apple-style, so content never renders below its smallest legible tier), an
// optional ceiling, an optional aspect band, and an optional resize policy. min
// defaults to ~mini tier; everything else is opt-in via the registry. Returns the
// unified shape applyConstraints / clampAspect both consume.
const DEFAULT_MIN_SIZE = { w: 4, h: 4 }
const constraintsFor = (type) => {
  const m = WIDGET_TYPES.get(type)
  return {
    min: { ...DEFAULT_MIN_SIZE, ...(m?.minSize || {}) },
    max: m?.maxSize ? { ...m.maxSize } : null, // no maxSize = no ceiling
    aspect: m?.aspect || null,
    resizable: m?.resizable,         // undefined = resizable (RGL default)
    resizeHandles: m?.resizeHandles, // undefined = grid default (all 8)
  }
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

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
  // Set by addWidget to the id of the just-added widget; an effect (below) then
  // scrolls its freshly-rendered node into view and flashes it — a new widget is
  // appended at the bottom of the board where it's easily missed.
  const pendingScrollId = useRef(null)
  // Transient Undo for the destructive "Reset layout" (mirrors the task list's 6s
  // undo): holds { label, fn } to restore the pre-reset board.
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)
  const showUndo = useCallback((label, fn) => {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])
  const dismissUndo = useCallback(() => { clearTimeout(undoTimer.current); setUndo(null) }, [])

  // Initial load: projects + saved layout (or a sensible default).
  useEffect(() => {
    (async () => {
      // Warm the shared task store NOW (fire-and-forget) so /api/tasks is already
      // in-flight before the task widgets mount and subscribe — otherwise the
      // first /tasks fetch is serialized after boot + render, leaving ~10s of
      // skeletons on a home CalDAV server. refresh() shares one in-flight request,
      // so the later subscribe reuses this rather than firing a second fetch. Not
      // awaited: the grid still renders as soon as the three boot fetches resolve.
      refresh()
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
        // The Frog widget was folded into the gamified Triage widget — remap any
        // saved instance in place (same `i`, so its grid slot is preserved) rather
        // than letting the unknown-type filter below silently drop it. Track the
        // remap so the migration is persisted (the filter alone wouldn't trigger a
        // write when nothing is dropped).
        let remapped = false
        const original = (saved.layout.widgets || []).map((w) => {
          if (w.type === 'frog') { remapped = true; return { ...w, type: 'triage' } }
          return w
        })
        const sw = original.filter((w) => WIDGET_TYPES.has(w.type))
        const storedV = saved.layout.gridV || 1
        let lay = saved.layout.layouts || {}
        const f = SCALE_TO_CURRENT[storedV] ?? 2.5
        const needsGrid = f !== 1
        if (needsGrid) lay = scaleLayouts(lay, f)
        // Ultrawide tiers (xl+) are always DERIVED from the base by scaling to
        // fill the width — never authoritative. Drop any persisted copy and
        // rebuild on EVERY load, so the fill is robust even when react-grid-layout
        // re-saves a de-scaled copy at a narrow viewport (otherwise that sticks
        // and the next wide load shows a half-empty board). fillBreakpoints scales
        // the base up into each wide tier; narrower tiers it leaves untouched.
        lay = { ...lay }
        for (const bp of ['xl', 'xxl', 'xxxl', 'xxxxl']) delete lay[bp]
        const before = Object.keys(lay).length
        lay = fillBreakpoints(lay)
        const addedBp = Object.keys(lay).length !== before
        setWidgets(sw)
        setLayouts(lay)
        if (sw.length !== original.length || needsGrid || addedBp || remapped) {
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
    pendingScrollId.current = w.i // scroll + flash it once it renders (effect below)
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
  // Reset is destructive (overwrites every widget + its placement), so snapshot the
  // current board first and offer a 6s Undo to restore it (parity with the rest of
  // the app), rather than wiping it irrecoverably.
  const resetLayout = () => {
    const prev = { widgets, layouts }
    const { widgets: def, layouts: lay } = buildDefault()
    setWidgets(def)
    setLayouts(lay)
    persist(def, lay)
    showUndo('Layout reset.', () => {
      setWidgets(prev.widgets)
      setLayouts(prev.layouts)
      persist(prev.widgets, prev.layouts)
    })
  }

  // Group creation happens only in Settings now — open it with the typed name.
  const onNewGroup = useCallback((name) => onOpenSettings?.({ createGroup: name }), [onOpenSettings])

  // The capability objects the app hands widgets through the connection layer.
  // Built once (stable identity), so ctx.tasks/ctx.groups/ctx.notes/ctx.calendar
  // wrap the app-owned singletons (the shared store, the buses, the API client) —
  // a widget reaches data ONLY through what it plugs into, never via direct import.
  const tasksCap = useMemo(() => ({
    subscribe, getTasks, getState, refresh, ensureLoaded,
    patchTask, removeTask, replaceTasks,
    update: updateTask, del: deleteTask, attachLabels,
    // Optimistically insert the created task into the shared store so it appears
    // in every widget at once (fixes the "added it but it vanished" gap); the
    // bus-debounced refetch then reconciles its full shape.
    create: async (pid, fields) => { const t = await createTask(pid, fields); insertTask(t); return t },
    emitChanged: emitTasksChanged, onChanged: onTasksChanged, isRealDate,
  }), [])
  const groupsCap = useMemo(() => ({
    fetch: reminderGroups, recent: recentGroups, pushRecent: pushRecentGroup, onNewGroup,
  }), [onNewGroup])
  const notesCap = useMemo(() => ({ ...notesApi, onOpenNote, emitOpenNote }), [])
  const calendarCap = useMemo(() => ({
    listEvents: (start, end) => api(`/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    createEvent: (body) => api('/api/calendar/events', { method: 'POST', body: JSON.stringify(body) }),
    updateEvent: (body) => api('/api/calendar/events', { method: 'PATCH', body: JSON.stringify(body) }),
    deleteEvent: (body) => api('/api/calendar/events', { method: 'DELETE', body: JSON.stringify(body) }),
    accounts: () => api('/api/caldav/accounts'),
  }), [])

  // The app slots: every interface the canvas provides, with its live value. A
  // widget receives only the subset it plugs into (see connections.js) — the
  // dashboard never hands a widget app state it didn't declare a dependency on.
  const appCtx = useMemo(
    () => ({ tasks: tasksCap, events, projects, groups: groupsCap, notes: notesCap, calendar: calendarCap, onOpenSettings }),
    [tasksCap, events, projects, groupsCap, notesCap, calendarCap, onOpenSettings],
  )
  const slots = useMemo(() => appSlots(appCtx), [appCtx])

  // Which declared widget requirements the host can satisfy right now (see
  // manifest.requires). A widget with an unmet, host-knowable requirement shows a
  // "connect it in Settings" placeholder instead of rendering.
  const available = useMemo(() => {
    const s = new Set()
    if (caldavAccounts > 0 || projects.length > 0) s.add('caldav')
    return s
  }, [caldavAccounts, projects.length])

  // Dev sanity check: warn once if a widget plugs into an interface the app
  // doesn't define (a typo'd / retired interface name) — caught at the registry,
  // not per saved widget, so it fires once regardless of how many are on the board.
  useEffect(() => {
    for (const r of describeConnections(WIDGETS, slots)) {
      if (r.unknown.length) console.warn(`[connections] widget "${r.type}" plugs into unknown interface(s): ${r.unknown.join(', ')}`)
    }
  }, [slots])

  // Stamp each item's size constraints (min/max floors + ceilings, resize policy)
  // from the registry at render time, so saved layouts never need migrating and the
  // constraints track the current registry. (Aspect isn't an RGL item prop — it's
  // enforced live in onResize below.)
  const layoutsWithConstraints = useMemo(() => applyConstraints(layouts, widgets, constraintsFor), [layouts, widgets])

  // After a widget is added it renders at the bottom of the board (off-screen on a
  // full board), with no feedback. Once its node exists, scroll it into view and
  // toggle a transient highlight (mirrors ReminderGroupsSection's scrollIntoView).
  // Keyed on `widgets` so it fires on the render that includes the new node; the
  // ref gate ensures it runs once per add, not on every layout/resize re-render.
  useEffect(() => {
    const id = pendingScrollId.current
    if (!id) return
    pendingScrollId.current = null
    const node = document.querySelector(`[data-wid="${id}"]`)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    node.classList.add('widget--added')
    const t = setTimeout(() => node.classList.remove('widget--added'), 1200)
    return () => clearTimeout(t)
  }, [widgets])

  // Enforce a widget's aspect band live during AND after a resize. RGL has already
  // clamped to the item's minW/maxW before calling us; we layer the aspect band on
  // top, then re-clamp into [min,max] so the ratio can't push the widget past its own
  // ceiling/floor. Mutating newItem + placeholder in place updates BOTH the committed
  // size and the live ghost preview (.react-grid-placeholder), so the widget snaps to
  // its shape as you drag. onResizeStop repeats it so the persisted size is exact.
  const typeOf = useMemo(() => new Map(widgets.map((w) => [w.i, w.type])), [widgets])
  const enforceAspect = useCallback((_layout, _oldItem, newItem, placeholder) => {
    const aspect = constraintsFor(typeOf.get(newItem.i)).aspect
    if (!aspect) return
    const snapped = clampAspect(newItem.w, newItem.h, aspect)
    const w = clamp(snapped.w, newItem.minW || 1, newItem.maxW || Infinity)
    const h = clamp(snapped.h, newItem.minH || 1, newItem.maxH || Infinity)
    newItem.w = w; newItem.h = h
    if (placeholder) { placeholder.w = w; placeholder.h = h }
  }, [typeOf])

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
            {/* A few concrete starters so a fresh board teaches its own shortcuts. */}
            <ul className="empty-tips state-sub" style={{ margin: '18px auto 0', maxWidth: 320, textAlign: 'left' }}>
              <li>Press ⌘K for the command palette</li>
              <li>Drag a widget&apos;s header to rearrange</li>
              <li>Quick-add like “gym tomorrow 7am !2 *health”</li>
            </ul>
          </div>
        ) : (
          <Grid
            className="layout"
            layouts={layoutsWithConstraints}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={30}
            margin={[16, 16]}
            draggableHandle=".widget-head"
            draggableCancel="button,.iconbtn,.widget-head-actions"
            resizeHandles={['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne']}
            onResize={enforceAspect}
            onResizeStop={enforceAspect}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => {
              const spec = WIDGET_TYPES.get(w.type)
              // Auto-connect the widget's declared plugs to the app slots, then
              // hand it ONLY the connected interfaces (least privilege).
              const { connections } = resolveConnections(spec?.plugs, slots)
              const ctx = selectCtx(appCtx, connections)
              // Gate on declared capability requirements the host can determine.
              const unmet = (spec?.requires || []).filter((r) => KNOWABLE_REQUIREMENTS.has(r) && !available.has(r))
              return (
                // data-wid lets addWidget's effect find this node to scroll/flash it.
                <div key={w.i} data-wid={w.i}>
                  <WidgetFrame type={w.type} title={titleFor(w)} group={w.group} onRemove={() => removeWidget(w.i)}>
                    <WidgetMount spec={spec} w={w} ctx={ctx}>
                      {unmet.length ? <WidgetRequirement reqs={unmet} onOpenSettings={onOpenSettings} /> : spec?.render(w, ctx)}
                    </WidgetMount>
                  </WidgetFrame>
                </div>
              )
            })}
          </Grid>
        )}
      </div>
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
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

/* ---------- Per-instance lifecycle (optional registry `lifecycle` hooks) ---------- */
// Runs a widget type's optional onMount/onUnmount once per INSTANCE (keyed to w.i,
// not ctx identity, so re-memoizing a capability doesn't re-fire them). Forward-
// looking: no widget declares lifecycle hooks today, but the host supports them.
function WidgetMount({ spec, w, ctx, children }) {
  const lifecycle = spec?.lifecycle
  useEffect(() => {
    lifecycle?.onMount?.(w, ctx)
    return () => lifecycle?.onUnmount?.(w)
  }, [w.i]) // eslint deps intentionally minimal: lifecycle is per-instance
  return children
}

/* ---------- Unmet capability requirement (manifest.requires) ---------- */
function WidgetRequirement({ reqs, onOpenSettings }) {
  const what = reqs.map((r) => REQUIREMENT_LABEL[r] || r).join(' & ')
  return (
    <div className="state">
      <div className="state-ic"><IconCloud size={22} /></div>
      <div className="state-title">Needs {what}</div>
      <div className="state-sub">Connect it in Settings to use this widget.</div>
      <button className="btn primary sm" style={{ marginTop: 10 }} onClick={() => onOpenSettings?.()}>
        <IconCloud size={14} /> Open Settings
      </button>
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
function WidgetFrame({ type, title, group, onRemove, children }) {
  const Ic = WIDGET_TYPES.get(type)?.icon || IconList
  // One ResizeObserver per widget, on the body (the real scroll container). The
  // resulting size class is broadcast through context so any widget can adapt its
  // *content* to its size (see useWidgetSize.js); data-* mirrors it for CSS-only
  // tweaks. This is the single place size is measured — every widget gets it free.
  const [bodyRef, size] = useElementSize()
  return (
    // Label each widget as a navigable region for screen readers. Drag/resize are
    // pointer-only (react-grid-layout has no keyboard path); the keyboard route to
    // change the board is the toolbar — Add widget / Reset layout — and each
    // widget's Remove button, which are all reachable controls.
    <div className="widget" role="group" aria-label={title}>
      <div className="widget-head" title="Drag to move (pointer); use the toolbar to change the layout">
        <span className="widget-title">
          <Ic size={17} />
          <span className="t-text">{title}</span>
          {/* A group-locked widget (pickGroup → w.group) only signals lock via its
              title; surface it explicitly so the lock is legible, not inferred. */}
          {group && <span className="lock-badge" title={`Locked to ${group}`}>Locked</span>}
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
      <div className="widget-body" ref={bodyRef} data-wsize={size.w} data-hsize={size.h}>
        {/* widgets are lazy (see registry.jsx) — skeleton while a chunk loads, and a
            boundary so a failed chunk/render can't blank the whole board */}
        <WidgetSizeContext.Provider value={size}>
          <WidgetBoundary>
            <Suspense fallback={<SkeletonRows n={4} />}>{children}</Suspense>
          </WidgetBoundary>
        </WidgetSizeContext.Provider>
      </div>
    </div>
  )
}

function titleFor(w) {
  const spec = WIDGET_TYPES.get(w.type)
  if (!spec) return w.type
  return spec.title ? spec.title(w) : spec.label
}
