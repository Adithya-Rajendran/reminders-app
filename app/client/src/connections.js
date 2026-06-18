// Widget ⇄ app "connections": a Snap-connections / Juju-relations style interface
// layer. The app (the canvas) PROVIDES a fixed set of named interfaces ("slots");
// a widget DECLARES the interfaces it needs ("plugs") in its registry entry. The
// dashboard auto-connects each plug to the matching slot — no user wiring — and
// hands a widget ONLY the interfaces it plugged into (see selectCtx). Reading app
// state a widget didn't plug into is, by design, impossible.
//
// Why this exists (vs. the old "pass every widget the same ctx bag"):
//   • Explicit + validated — a widget's data dependencies are declared, and a
//     typo'd / retired interface name is caught (resolveConnections → unknown).
//   • Least privilege — a widget receives exactly what it asked for, nothing more.
//   • Visible — Settings → Connections lists every plug and its status, like
//     `snap connections`.
//   • Forward-looking — the SAME plug/slot model extends to widget→widget
//     connections (a widget PROVIDING an interface other widgets plug into). The
//     resolver is generic over the catalog and the set of available providers, so
//     that path is a drop-in later; `scope` marks who provides an interface today.
//
// Pure module (no React/DOM) so the framework-free node tests can exercise it
// (test/connections.test.mjs). Returned objects are frozen — safe to share through
// React context without a defensive copy.

// The catalog of interfaces the application/canvas provides. Each interface maps
// to the ctx prop names it injects into a widget's render() (`keys`) — so widget
// render() signatures stay byte-identical to the pre-connections ctx bag. A
// keyless interface (like `tasks`) is a declarative dependency only: it's consumed
// via a module singleton (the shared task store / useTaskList), not through ctx.
export const APP_INTERFACES = Object.freeze({
  'tasks': Object.freeze({
    scope: 'app',
    summary: 'Shared task store — one /api/tasks fetch per board, optimistic edits + undo (ambient via useTaskList).',
    keys: Object.freeze([]),
  }),
  'reminder-events': Object.freeze({
    scope: 'app',
    summary: 'Live reminder/overdue events from the in-app scheduler (SSE feed).',
    keys: Object.freeze(['events']),
  }),
  'projects': Object.freeze({
    scope: 'app',
    summary: 'The user’s CalDAV task projects/lists (the inbox is projects[0]).',
    keys: Object.freeze(['projects']),
  }),
  'reminder-groups': Object.freeze({
    scope: 'app',
    summary: 'Reminder groups + the “new group” affordance (opens Settings prefilled).',
    keys: Object.freeze(['onNewGroup']),
  }),
  'settings': Object.freeze({
    scope: 'app',
    summary: 'Open the Settings panel (e.g. to connect a CalDAV / Nextcloud account).',
    keys: Object.freeze(['onOpenSettings']),
  }),
})

export const isKnownInterface = (name, catalog = APP_INTERFACES) =>
  Object.prototype.hasOwnProperty.call(catalog, name)

// Accept plugs as a bare array of interface names, or entries
// { interface, optional }. Junk-tolerant (ignore falsy / non-string interfaces),
// deduped (a plug connects once), and required-wins-over-optional on a duplicate
// so an accidental `{ optional: true }` can't weaken a hard dependency.
export function normalizePlugs(plugs) {
  if (!Array.isArray(plugs)) return Object.freeze([])
  const byName = new Map()
  for (const p of plugs) {
    const entry = typeof p === 'string'
      ? { interface: p, optional: false }
      : (p && typeof p === 'object' && typeof p.interface === 'string' ? { interface: p.interface, optional: !!p.optional } : null)
    if (!entry || !entry.interface) continue
    const prev = byName.get(entry.interface)
    // required wins: once a hard dependency, stay a hard dependency.
    if (prev) { if (prev.optional && !entry.optional) prev.optional = false; continue }
    byName.set(entry.interface, entry)
  }
  return Object.freeze([...byName.values()].map((e) => Object.freeze(e)))
}

// Resolve a widget's plugs against the set of interface names the environment
// provides (the app slots today; app + sibling-widget slots in the future).
// Auto-connects every plug whose interface is both known (in the catalog) and
// provided — like snap auto-connection.
export function resolveConnections(plugs, available, catalog = APP_INTERFACES) {
  const provided = available instanceof Set ? available : new Set(available || [])
  const norm = normalizePlugs(plugs)
  const connections = []
  const unknown = []
  const missing = []
  for (const plug of norm) {
    const known = isKnownInterface(plug.interface, catalog)
    const connected = known && provided.has(plug.interface)
    connections.push(Object.freeze({ interface: plug.interface, optional: plug.optional, known, connected }))
    if (!known) unknown.push(plug.interface)
    else if (!connected && !plug.optional) missing.push(plug.interface)
  }
  return Object.freeze({
    connections: Object.freeze(connections),
    unknown: Object.freeze(unknown),
    missing: Object.freeze(missing),
  })
}

// The ctx prop names a set of CONNECTED plugs should inject — the union of each
// connected interface's `keys`. Used to hand a widget exactly the app state it
// plugged into.
export function connectedCtxKeys(connections, catalog = APP_INTERFACES) {
  const keys = new Set()
  for (const c of (connections || [])) {
    if (!c.connected) continue
    for (const k of (catalog[c.interface]?.keys || [])) keys.add(k)
  }
  return keys
}

// Given the full app ctx (all slot values) and a widget's resolved connections,
// return the frozen subset of ctx the widget plugged into. This is the layer's
// enforcement: a widget literally cannot see a key it didn't plug an interface for.
export function selectCtx(fullCtx, connections, catalog = APP_INTERFACES) {
  const out = {}
  const src = fullCtx || {}
  for (const k of connectedCtxKeys(connections, catalog)) out[k] = src[k]
  return Object.freeze(out)
}

// The set of interface names the app currently provides, given the live ctx.
// A keyless interface (e.g. `tasks`, an ambient module singleton) is always
// provided; a keyed interface is provided only when every ctx key it injects is
// present (!== undefined) — so a board built without, say, onOpenSettings would
// honestly report `settings` as unavailable.
export function appSlots(ctx = {}, catalog = APP_INTERFACES) {
  const names = new Set()
  for (const [name, spec] of Object.entries(catalog)) {
    if (spec.scope !== 'app') continue
    const keys = spec.keys || []
    if (keys.every((k) => ctx[k] !== undefined)) names.add(name)
  }
  return names
}

// A per-widget-type connection report for the Settings viewer (and a dev-time
// "unknown interface" warning). `specs` are registry entries ({ type, label,
// plugs }); `available` is the provided-interface set.
export function describeConnections(specs, available, catalog = APP_INTERFACES) {
  const provided = available instanceof Set ? available : new Set(available || [])
  return (specs || []).map((spec) => {
    const { connections, unknown, missing } = resolveConnections(spec.plugs, provided, catalog)
    return Object.freeze({ type: spec.type, label: spec.label, connections, unknown, missing })
  })
}
