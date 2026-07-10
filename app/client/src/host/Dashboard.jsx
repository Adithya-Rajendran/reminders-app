import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import { api, tk, reminderGroups, notesApi } from '../data/api.js'
import { subscribe, getTasks, getState, refresh, ensureLoaded, patchTask, removeTask, replaceTasks, insertTask } from '../data/taskstore.js'
import { getOrganizerFilter, setOrganizerFilter, subscribeOrganizerFilter } from '../domain/organizerfilter.js'
import { updateTask, createTask, deleteTask, attachLabels, isRealDate } from '../domain/tasklib.js'
import { selectContexts } from '../domain/taskviews.js'
import { emitTasksChanged, onTasksChanged } from '../data/tasksbus.js'
import { onOpenNote, emitOpenNote, hasOpenNoteListener } from '../data/notesbus.js'
import { WIDGETS, WIDGET_TYPES, DEFAULT_BOARD } from '../widgets/registry.jsx'
import { appSlots, describeConnections } from '../connections.js'
import { ConnectedWidget, titleFor } from './ConnectedWidget.jsx'
import { BoardFilterBar } from './BoardFilterBar.jsx'
import { MobileShell } from './MobileShell.jsx'
import { SkeletonRows, UndoBar } from '../widget-sdk'
import {
  COLS, BREAKPOINTS, GRID_V, SCALE_TO_CURRENT, DEFAULT_SIZE,
  scaleLayouts, appendToLayouts, fillBreakpoints, applyConstraints, clampAspect,
  applyCollapsed, restoreCollapsedHeights,
  stripDerivedTiers, boardSignature,
} from '../domain/dashlayout.js'
import { appCache } from '../data/fetchcache.js'
import { useElementSize, WidgetSizeContext } from '../widget-sdk/useWidgetSize.js'
import { usePopover } from '../widget-sdk/usePopover.js'
import WidgetBoundary from '../widgets/WidgetBoundary.jsx'
import { GroupList } from '../widget-sdk'
import { recentGroups, pushRecentGroup } from '../domain/groups.js'
import { saveJson } from '../widget-sdk/storage.js'
import { useMediaQuery } from './useMediaQuery.js'
import { publishBoard, onGoToWidget, onAddWidget } from '../data/boardbus.js'
import {
  IconPlus, IconChevDown, IconChevR, IconChevL,
  IconList, IconBell, IconCloud,
  IconX, IconInbox, IconRefresh, IconGear, IconCheck,
} from '../widget-sdk/icons.jsx'
import { resolveWidgetConfig } from '../widgets/manifest.js'

const Grid = WidthProvider(Responsive)

// Group counts derive from tasks, so any task mutation drops the cached groups
// read. Module scope on purpose: bus handlers run in subscription order, and an
// import-time registration precedes every widget's mount-effect subscription —
// so the widgets' own bus-driven refetch misses the cache and pulls fresh
// counts (one coalesced request between them, not one each).
onTasksChanged(() => appCache.invalidate('groups'))

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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
// Grid rows a collapsed widget occupies (header only) — ~76px at rowHeight 30 + 16
// margin, enough for the header bar with the body hidden.
const COLLAPSED_H = 2

// Scroll a widget's frame into view and flash it — shared by the add-widget
// feedback and the palette's "Go to <widget>" commands.
function scrollFlash(id) {
  const node = document.querySelector(`[data-wid="${id}"]`)
  if (!node) return
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  node.classList.add('widget--added')
  setTimeout(() => node.classList.remove('widget--added'), 1200)
}

// The fresh board's base (lg, 30-col) placement: a 2-row tile hand-fitted so all
// four default widgets sit in ~15 rows and clear a 1512×982 laptop viewport WITHOUT
// scrolling. (The old x%cols placement overlapped, so react-grid-layout untangled
// them into a taller staircase with a dead top-right hole.) Each w/h stays inside
// the widget's manifest aspect band + max — widget-contract invariants, checked by
// buildDefault-shape assumptions below. Row 1: overview + upcoming (h7); row 2:
// daily + calendar (h8).
const DEFAULT_BOARD_LG = {
  overview: { x: 0, y: 0, w: 16, h: 7 },
  upcoming: { x: 16, y: 0, w: 10, h: 7 },
  daily: { x: 0, y: 7, w: 8, h: 8 },
  calendar: { x: 8, y: 7, w: 11, h: 8 },
}
// A clean default dashboard (DEFAULT_BOARD in the registry). The curated lg base is
// the only authored tier; every other breakpoint is DERIVED by fillBreakpoints —
// wider tiers (xl…xxxxl) scale to FILL the width (so a fresh 5K2K board uses the
// display, clamped to each widget's aspect band), narrower tiers repack — exactly
// as a loaded board is rebuilt on every load.
function buildDefault() {
  const def = DEFAULT_BOARD.map((type) => ({ i: newId(), type }))
  const lg = def.map((w) => ({ i: w.i, ...(DEFAULT_BOARD_LG[w.type] || { x: 0, y: 0, ...sizeFor(w.type) }) }))
  const byId = new Map(def.map((w) => [w.i, w.type]))
  const layouts = fillBreakpoints({ lg }, (id) => constraintsFor(byId.get(id)))
  return { widgets: def, layouts }
}

export default function Dashboard({ onOpenSettings, onCapture, dashboardId = 'main', title, metaTick = 0 }) {
  // Below a phone-ish width, swap the composable grid for a single-view bottom-tab
  // shell — a widget stack is unusable on a 390px screen (the persona ask).
  const isMobile = useMediaQuery('(max-width: 680px)')
  const [projects, setProjects] = useState([])
  const [caldavAccounts, setCaldavAccounts] = useState(null) // null until loaded
  const [widgets, setWidgets] = useState([])
  const [layouts, setLayouts] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [events, setEvents] = useState([])
  const saveTimer = useRef(null)
  // boardSignature of the last board we loaded or persisted — persist() skips
  // the PUT when nothing semantically changed (see dashlayout.boardSignature).
  const lastSavedSig = useRef(null)
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
      // Projects/accounts go through the shared cache: App's inbox resolve and
      // the calendar widget ask for the same things within the same breath.
      const [prR, acctR, savedR] = await Promise.allSettled([
        appCache.cached('projects', () => tk('/projects'), { ttl: 60_000 }),
        appCache.cached('caldav-accounts', () => api('/api/caldav/accounts'), { ttl: 60_000 }),
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
        lay = stripDerivedTiers(lay)
        // Keep the ultrawide fill inside each widget's aspect band + max, so a wide
        // screen doesn't stretch widgets past a cohesive shape (it may leave a gap).
        const typeById = new Map(sw.map((w) => [w.i, w.type]))
        lay = fillBreakpoints(lay, (id) => constraintsFor(typeById.get(id)))
        setWidgets(sw)
        setLayouts(lay)
        // Seed the no-op-save guard with what's on the server (as we'd persist
        // it), so react-grid-layout's mount-time onLayoutChange echo doesn't PUT
        // an identical board back on every plain page load. Rebuilding the
        // derived tiers is NOT a persistable change (they're stripped from every
        // save); only real cleanups below warrant a boot write.
        lastSavedSig.current = boardSignature(sw, lay)
        // Remember this board's widget types so the NEXT visit can warm their
        // chunks before this layouts fetch even resolves (see App's preload).
        saveJson('reminders-last-board-' + dashboardId, sw.map((w) => w.type))
        if (sw.length !== original.length || needsGrid || remapped) {
          api('/api/layouts/' + dashboardId, {
            method: 'PUT',
            body: JSON.stringify({ layout: { version: 1, gridV: GRID_V, widgets: sw, layouts: stripDerivedTiers(lay) } }),
          }).catch(() => { lastSavedSig.current = null }) // failed migration save -> the next real change re-persists it
        }
      } else {
        const { widgets: def, layouts: lay } = buildDefault()
        setWidgets(def)
        setLayouts(lay)
        lastSavedSig.current = boardSignature(def, lay)
        saveJson('reminders-last-board-' + dashboardId, def.map((w) => w.type))
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
        // The envelope key consumers filter on is `receivedAt` (notiftier.js);
        // keep `at` too for anything sorting on it.
        setEvents((prev) => [{ at: Date.now(), receivedAt: Date.now(), data }, ...prev].slice(0, 50))
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

  // Which widgets are collapsed (header-only) — layered onto the constrained layouts
  // at render, and reversed in onLayoutChange so the real (expanded) height survives.
  const collapsedIds = useMemo(() => new Set(widgets.filter((w) => w.collapsed).map((w) => w.i)), [widgets])

  const persist = useCallback((nextWidgets, nextLayouts) => {
    if (!loaded) return // gate saves until after hydration (RGL footgun)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // Skip no-op saves: RGL fires onLayoutChange on mount and on modal
      // scrollbar jitter with nothing semantically changed — each was a
      // needless PUT + SQLite write on every page view. Derived tiers are
      // stripped from the persisted body (they're rebuilt on every load).
      const sig = boardSignature(nextWidgets, nextLayouts)
      if (sig === lastSavedSig.current) return
      lastSavedSig.current = sig
      api('/api/layouts/' + dashboardId, {
        method: 'PUT',
        body: JSON.stringify({ layout: { version: 1, gridV: GRID_V, widgets: nextWidgets, layouts: stripDerivedTiers(nextLayouts) } }),
      }).catch(() => { lastSavedSig.current = null }) // failed save -> next layout event retries instead of no-op-skipping
    }, 600)
  }, [loaded, dashboardId])

  const onLayoutChange = (_current, all) => {
    if (!loaded) return
    // Collapsed widgets render at a locked header height; restore their real height
    // from the source layouts so RGL's report can't overwrite the expanded size.
    const restored = restoreCollapsedHeights(all, layouts, collapsedIds)
    setLayouts(restored)
    persist(widgets, restored)
  }

  // Collapse/expand a widget to header-only (a header-level minimize). Persisted on
  // the widget item; boardSignature counts it, so the save isn't skipped as a no-op.
  const toggleCollapse = (id) => {
    const nextWidgets = widgets.map((w) => (w.i === id ? { ...w, collapsed: !w.collapsed } : w))
    setWidgets(nextWidgets)
    persist(nextWidgets, layouts)
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

  // Persist a widget instance's per-instance config (manifest `config` schema).
  // The saved object is normalized against the widget's schema first — unknown
  // keys dropped, values validated — so a stale/edited layout can never persist a
  // config the widget can't consume. Storing only the validated subset also keeps
  // w.config small and forward-safe.
  const configureWidget = (id, nextConfig) => {
    const type = widgets.find((w) => w.i === id)?.type
    const schema = WIDGET_TYPES.get(type)?.config
    const clean = resolveWidgetConfig(schema, nextConfig)
    const nextWidgets = widgets.map((w) => (w.i === id ? { ...w, config: clean } : w))
    setWidgets(nextWidgets)
    // boardSignature (the no-op-save guard) intentionally hashes only identity /
    // type / group / placement, not w.config — so force this write through by
    // clearing the last-saved signature, or a config-only change would be skipped.
    lastSavedSig.current = null
    persist(nextWidgets, layouts)
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
    // Cached: several widgets ask for groups on the same triggers (mount, tasks
    // bus). The bus invalidation registered at module scope keeps counts fresh.
    fetch: () => appCache.cached('groups', reminderGroups, { ttl: 30_000 }),
    recent: recentGroups, pushRecent: pushRecentGroup, onNewGroup,
  }), [onNewGroup])
  const notesCap = useMemo(() => ({ ...notesApi, onOpenNote, emitOpenNote, hasOpenNoteListener }), [])
  const calendarCap = useMemo(() => ({
    listEvents: (start, end) => api(`/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    createEvent: (body) => api('/api/calendar/events', { method: 'POST', body: JSON.stringify(body) }),
    updateEvent: (body) => api('/api/calendar/events', { method: 'PATCH', body: JSON.stringify(body) }),
    deleteEvent: (body) => api('/api/calendar/events', { method: 'DELETE', body: JSON.stringify(body) }),
    accounts: () => appCache.cached('caldav-accounts', () => api('/api/caldav/accounts'), { ttl: 60_000 }),
  }), [])
  // The daily plan lives server-side (syncs across browsers, readable by
  // integrations); widgets reach it only through this capability.
  const planCap = useMemo(() => ({
    get: (date) => api('/api/daily-plan?date=' + encodeURIComponent(date)),
    set: (date, ids) => api('/api/daily-plan', { method: 'PUT', body: JSON.stringify({ date, ids }) }),
  }), [])
  // The organizing dimension (v2): the Projects/Areas registry, the derived set of
  // Contexts (task labels), and the global active filter. The filter is an external
  // store (organizerfilter.js) so widgets react via useSyncExternalStore while this
  // capability stays a stable reference. Areas aren't cached — a small, rarely-read
  // list where staleness (a just-created area not showing) is worse than a refetch.
  const organizerCap = useMemo(() => ({
    areas: () => api('/api/areas'),
    createArea: (body) => api('/api/areas', { method: 'POST', body: JSON.stringify(body) }),
    updateArea: (id, body) => api('/api/areas/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }),
    removeArea: (id) => api('/api/areas/' + encodeURIComponent(id), { method: 'DELETE' }),
    contexts: () => selectContexts(getTasks()),
    getFilter: getOrganizerFilter, setFilter: setOrganizerFilter, subscribe: subscribeOrganizerFilter,
  }), [])

  // The app slots: every interface the canvas provides, with its live value. A
  // widget receives only the subset it plugs into (see connections.js) — the
  // dashboard never hands a widget app state it didn't declare a dependency on.
  const appCtx = useMemo(
    () => ({ tasks: tasksCap, events, projects, groups: groupsCap, notes: notesCap, calendar: calendarCap, plan: planCap, organizer: organizerCap, onOpenSettings }),
    [tasksCap, events, projects, groupsCap, notesCap, calendarCap, planCap, organizerCap, onOpenSettings],
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
  const layoutsWithConstraints = useMemo(
    () => applyCollapsed(applyConstraints(layouts, widgets, constraintsFor), collapsedIds, COLLAPSED_H),
    [layouts, widgets, collapsedIds],
  )

  // After a widget is added it renders at the bottom of the board (off-screen on a
  // full board), with no feedback. Once its node exists, scroll it into view and
  // toggle a transient highlight (mirrors ReminderGroupsSection's scrollIntoView).
  // Keyed on `widgets` so it fires on the render that includes the new node; the
  // ref gate ensures it runs once per add, not on every layout/resize re-render.
  useEffect(() => {
    const id = pendingScrollId.current
    if (!id) return
    pendingScrollId.current = null
    scrollFlash(id)
  }, [widgets])

  // Publish the board contents for the palette's "Go to <widget>" commands, and
  // honor go-to / add-widget requests with the same scroll+flash. GATED to the grid:
  // on mobile there is no grid (MobileShell owns nav), so publishing the hidden grid
  // or letting "Go to"/"Add" flash/mutate an unmounted board would silently dead-end
  // (a no-op flash) or invisibly persist a layout change — MobileShell handles these.
  useEffect(() => {
    if (isMobile) return undefined
    // Include `type` so the palette can build type-aware nav (aliases per surface,
    // and "Add <surface>" for a type not on this board).
    publishBoard(widgets.map((w) => ({ i: w.i, title: titleFor(w), type: w.type })))
    return () => publishBoard([])
  }, [widgets, isMobile])
  useEffect(() => (isMobile ? undefined : onGoToWidget(scrollFlash)), [isMobile])
  // The omnibox's "Add <surface>" nav entries add a widget by type (same path as
  // the toolbar's Add-widget menu, so it scroll-flashes into view once rendered).
  useEffect(() => (isMobile ? undefined : onAddWidget((type) => addWidget(type))), [addWidget, isMobile])

  // Settings closed (metaTick bumped): accounts/projects may have changed —
  // re-check the onboarding meta so a freshly connected account lifts the gate
  // without a page reload. appCache was cleared by App, so these re-fetch.
  useEffect(() => {
    if (!metaTick) return
    let alive = true
    ;(async () => {
      const [prR, acctR] = await Promise.allSettled([
        appCache.cached('projects', () => tk('/projects'), { ttl: 60_000 }),
        appCache.cached('caldav-accounts', () => api('/api/caldav/accounts'), { ttl: 60_000 }),
      ])
      if (!alive) return
      if (prR.status === 'fulfilled') setProjects(Array.isArray(prR.value) ? prR.value.filter((p) => p.id > 0) : [])
      if (acctR.status === 'fulfilled') setCaldavAccounts((acctR.value?.accounts || []).length)
    })()
    return () => { alive = false }
  }, [metaTick])

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
    // Widget-shaped skeletons (not a text card): the board appears to assemble
    // rather than flash from "Loading…" to a full grid.
    return (
      <div className="grid-wrap" aria-label="Loading your dashboard" role="status">
        <div className="dash-skel">
          {[0, 1, 2].map((i) => (
            <div key={i} className="widget glass dash-skel-card"><SkeletonRows n={4} /></div>
          ))}
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

  // Mobile: a bottom-tab single-view shell across the spine (Today · Inbox ·
  // Calendar · Notes · Review) + a capture FAB, instead of a scrolling widget stack.
  if (isMobile) {
    return (
      <MobileShell
        appCtx={appCtx}
        slots={slots}
        available={available}
        organizerCap={organizerCap}
        onOpenSettings={onOpenSettings}
        onCapture={onCapture}
        dashboardId={dashboardId}
      />
    )
  }

  return (
    <>
      <Toolbar projects={projects} onAdd={addWidget} onReset={resetLayout} onNewGroup={onNewGroup} title={title} />
      <BoardFilterBar organizer={organizerCap} />
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
              <li>Press <kbd>c</kbd> anywhere to capture a task</li>
              <li>Ctrl/⌘ K searches tasks, notes &amp; commands — <kbd>?</kbd> for all shortcuts</li>
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
              // A per-instance config schema (manifest `config`) surfaces a gear on
              // the widget head; resolveWidgetConfig fills the form with the merged,
              // validated current values (defaults <- saved). The connection wiring
              // + requirement gate + render live in ConnectedWidget (shared with the
              // mobile shell); the frame owns only the head/collapse/remove/config.
              const configSchema = WIDGET_TYPES.get(w.type)?.config
              return (
                // data-wid lets addWidget's effect find this node to scroll/flash it.
                <div key={w.i} data-wid={w.i}>
                  <WidgetFrame
                    type={w.type}
                    title={titleFor(w)}
                    group={w.group}
                    collapsed={!!w.collapsed}
                    onToggleCollapse={() => toggleCollapse(w.i)}
                    onRemove={() => removeWidget(w.i)}
                    configSchema={configSchema}
                    configValues={configSchema ? resolveWidgetConfig(configSchema, w.config) : null}
                    onConfigure={configSchema ? (next) => configureWidget(w.i, next) : undefined}
                  >
                    <ConnectedWidget w={w} appCtx={appCtx} slots={slots} available={available} onOpenSettings={onOpenSettings} />
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
        <div className="state-sub" style={{ margin: '8px auto 12px', maxWidth: 360 }}>
          Your tasks &amp; reminders live in your own CalDAV server — Nextcloud, Apple iCloud, or any
          CalDAV provider. Connect an account to start adding tasks.
        </div>
        {/* What each provider actually needs — saves a round-trip to the docs. */}
        <ul className="state-sub" style={{ margin: '0 auto 20px', maxWidth: 360, textAlign: 'left' }}>
          <li><b>Nextcloud</b> — your server URL + an app password (Settings → Security)</li>
          <li><b>Apple iCloud</b> — an app-specific password from appleid.apple.com</li>
          <li><b>Any CalDAV server</b> — its URL and your credentials</li>
        </ul>
        <button className="btn primary" onClick={onOpenSettings}>
          <IconCloud size={16} /> Open Settings to connect
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
      <div className="toolbar-title">
        <h1>{title || 'Dashboard'}</h1>
        <span className="sub">{dateLabel}</span>
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
                  <button key={m.type} className="menu-item menu-item-widget" role="menuitem" onClick={() => (m.pickGroup ? setSub(m.type) : add(m.type))} aria-haspopup={m.pickGroup ? 'menu' : undefined}>
                    <I size={16} />
                    <span className="menu-item-main">
                      <span>{m.label}</span>
                      {/* One-line purpose per widget — the label alone doesn't say
                          what "Cues" or "Triage" will do to your board. */}
                      {m.desc && <span className="menu-item-desc">{m.desc}</span>}
                    </span>
                    {m.pickGroup && <IconChevR size={15} className="chev" />}
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
function WidgetFrame({ type, title, group, collapsed, onToggleCollapse, onRemove, children, configSchema, configValues, onConfigure }) {
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
    // data-wsize mirrors the same tier already stamped on .widget-body — the
    // header lives outside that element, so a CSS-only fallback for the serif
    // .widget-title at the narrowest tier (see styles.css) needs it up here too.
    <div className={`widget${collapsed ? ' collapsed' : ''}`} data-wsize={size.w} role="group" aria-label={title}>
      <div className="widget-head" title="Drag to move (pointer); use the toolbar to change the layout">
        <span className="widget-title">
          <Ic size={17} />
          <span className="t-text">{title}</span>
          {/* A group-locked widget (pickGroup → w.group) only signals lock via its
              title; surface it explicitly so the lock is legible, not inferred. */}
          {group && <span className="lock-badge" title={`Locked to ${group}`}>Locked</span>}
        </span>
        <span className="widget-head-actions">
          {/* Gear only for widget types that DECLARE a config schema (manifest
              `config`) — opens a generic form built from that schema. */}
          {configSchema && onConfigure && (
            <WidgetConfigButton title={title} schema={configSchema} values={configValues} onSave={onConfigure} />
          )}
          {/* Collapse/expand to header-only. Always visible (unlike the hover-only
              remove) so the header's controls are discoverable at a glance. */}
          {onToggleCollapse && (
            <button
              className="iconbtn sm widget-collapse"
              aria-label={collapsed ? `Expand ${title} widget` : `Collapse ${title} widget`}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand' : 'Collapse'}
              onClick={onToggleCollapse}
            >
              <IconChevDown size={15} style={{ transform: collapsed ? 'none' : 'rotate(180deg)', transition: 'transform 120ms ease' }} />
            </button>
          )}
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

/* ---------- Per-instance config (manifest `config` schema) ---------- */
// The gear on a widget's head + the popover that holds its generic config form.
// Only mounted for widget types that declare a `config` schema (see WidgetFrame).
function WidgetConfigButton({ title, schema, values, onSave }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} ref={ref}>
      <button
        className="iconbtn sm"
        aria-label={`Configure ${title} widget`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Configure widget"
        onClick={() => setOpen((o) => !o)}
      >
        <IconGear size={15} />
      </button>
      {open && (
        <div className="menu widget-cfg-pop" role="dialog" aria-label={`${title} settings`} style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', padding: 12, minWidth: 240, animation: 'menuIn 150ms ease' }}>
          <WidgetConfigForm schema={schema} values={values} onSave={(next) => { onSave(next); setOpen(false) }} />
        </div>
      )}
    </span>
  )
}

// A generic form rendered from a widget's config SCHEMA (array of typed field
// descriptors). Pure UI over data: it knows the four field types, not any widget.
// Local draft state so edits are staged and committed on Save (not persisted per
// keystroke); the parent normalizes+validates the draft again before saving.
// Exported for the component test — the schema→form mapping is the testable part.
export function WidgetConfigForm({ schema, values, onSave }) {
  const [draft, setDraft] = useState(() => ({ ...values }))
  const set = (key, val) => setDraft((d) => ({ ...d, [key]: val }))
  const submit = (e) => { e.preventDefault(); onSave(draft) }
  return (
    <form onSubmit={submit} className="widget-cfg-form">
      {(schema || []).map((f) => {
        const id = `cfg-${f.key}`
        return (
          <div key={f.key} className="field" style={{ marginBottom: 10 }}>
            {f.type === 'boolean' ? (
              <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input id={id} type="checkbox" checked={!!draft[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            ) : (
              <>
                <label htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'number' ? (
                  <input
                    id={id} className="input" type="number"
                    value={draft[f.key]}
                    min={f.min} max={f.max}
                    onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))}
                  />
                ) : f.type === 'select' ? (
                  <select id={id} className="input" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                    {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={id} className="input" type="text" value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </>
            )}
          </div>
        )
      })}
      <button type="submit" className="btn primary sm" style={{ width: '100%' }}>
        <IconCheck size={14} /> Save
      </button>
    </form>
  )
}
