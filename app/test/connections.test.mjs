import {
  APP_INTERFACES, isKnownInterface, normalizePlugs, resolveConnections,
  connectedCtxKeys, selectCtx, appSlots, describeConnections,
} from '../client/src/connections.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const setEq = (s, arr) => s.size === arr.length && arr.every((x) => s.has(x))

// --- catalog basics ---
ok(isKnownInterface('tasks') && isKnownInterface('settings'), 'known interfaces resolve')
ok(!isKnownInterface('nope'), 'unknown interface is not known')
ok(Object.isFrozen(APP_INTERFACES) && Object.isFrozen(APP_INTERFACES.tasks), 'catalog + entries frozen')
ok(APP_INTERFACES['reminder-events'].keys[0] === 'events', 'reminder-events injects ctx.events')

// --- normalizePlugs: shapes, dedupe, required-wins, junk-tolerance ---
ok(normalizePlugs(['tasks']).length === 1 && normalizePlugs(['tasks'])[0].interface === 'tasks', 'string plug -> entry')
ok(normalizePlugs([{ interface: 'tasks', optional: true }])[0].optional === true, 'object plug keeps optional')
ok(normalizePlugs(['tasks', 'tasks']).length === 1, 'dedupe identical plugs')
// required-wins: optional then required (and vice-versa) collapse to required
ok(normalizePlugs([{ interface: 't', optional: true }, 't']).every((e) => e.optional === false), 'required wins over optional (opt first)')
ok(normalizePlugs(['t', { interface: 't', optional: true }]).every((e) => e.optional === false), 'required wins over optional (req first)')
ok(normalizePlugs([null, 5, {}, { interface: '' }, { optional: true }, 'ok']).map((e) => e.interface).join(',') === 'ok', 'junk entries dropped')
ok(normalizePlugs(undefined).length === 0 && normalizePlugs('tasks').length === 0, 'non-array -> empty')
ok(Object.isFrozen(normalizePlugs(['tasks'])) && Object.isFrozen(normalizePlugs(['tasks'])[0]), 'normalized list + entries frozen')

// --- resolveConnections: connected / missing / optional-missing / unknown ---
const r = resolveConnections(['tasks', 'settings', 'reminder-events', 'ghost', { interface: 'projects', optional: true }], ['tasks', 'settings'])
const byName = Object.fromEntries(r.connections.map((c) => [c.interface, c]))
ok(byName.tasks.connected && byName.settings.connected, 'provided + known -> connected')
ok(byName['reminder-events'].known && !byName['reminder-events'].connected, 'known but unprovided -> not connected')
ok(byName.ghost.known === false && byName.ghost.connected === false, 'absent from catalog -> unknown')
ok(setEq(new Set(r.unknown), ['ghost']), 'unknown lists only ghost')
ok(setEq(new Set(r.missing), ['reminder-events']), 'missing = required & known & unprovided (optional projects excluded)')
ok(Object.isFrozen(r) && Object.isFrozen(r.connections) && Object.isFrozen(r.connections[0]), 'resolve result deeply frozen')
const empty = resolveConnections([], [])
ok(empty.connections.length === 0 && empty.unknown.length === 0 && empty.missing.length === 0, 'no plugs -> empty report')

// --- connectedCtxKeys: union of connected interfaces, keyless contributes nothing ---
const remPlugs = ['tasks', 'reminder-events', 'projects', 'reminder-groups']
const remConn = resolveConnections(remPlugs, appSlots({ events: [], projects: [], onNewGroup() {}, onOpenSettings() {} })).connections
ok(setEq(connectedCtxKeys(remConn), ['events', 'projects', 'onNewGroup']), 'reminders keys = events+projects+onNewGroup')
ok(!connectedCtxKeys(resolveConnections(['tasks'], ['tasks']).connections).has('events'), 'keyless `tasks` injects nothing')

// --- selectCtx: isolation (no leak) + frozen ---
const fullCtx = { events: [1], projects: [2], onNewGroup: 'g', onOpenSettings: 's' }
const notesConn = resolveConnections(['settings'], appSlots(fullCtx)).connections
const notesCtx = selectCtx(fullCtx, notesConn)
ok(setEq(new Set(Object.keys(notesCtx)), ['onOpenSettings']), 'notes sees only onOpenSettings')
ok(notesCtx.events === undefined && notesCtx.projects === undefined, 'un-plugged keys are invisible (no leak)')
ok(Object.isFrozen(notesCtx), 'selected ctx is frozen')
ok(Object.keys(selectCtx(fullCtx, resolveConnections([], []).connections)).length === 0, 'no plugs -> empty ctx')

// --- appSlots: presence-detection ---
ok(appSlots({}).has('tasks'), 'keyless `tasks` always provided')
ok(!appSlots({}).has('reminder-events'), 'reminder-events unprovided when events missing')
ok(appSlots({ events: [] }).has('reminder-events'), 'reminder-events provided once events present (even empty array)')
ok(!appSlots({ events: undefined }).has('reminder-events'), 'explicit undefined still counts as unprovided')
ok(appSlots({ events: [], projects: [], onNewGroup() {}, onOpenSettings() {} }).size === 5, 'full ctx provides all five app slots')

// --- describeConnections: status mapping for the settings viewer ---
const specs = [
  { type: 'reminders', label: 'Reminders', plugs: remPlugs },
  { type: 'broken', label: 'Broken', plugs: ['ghost'] },
]
const report = describeConnections(specs, appSlots({ events: [], projects: [], onNewGroup() {}, onOpenSettings() {} }))
ok(report[0].connections.every((c) => c.connected) && report[0].unknown.length === 0, 'reminders fully connected')
ok(report[1].unknown.length === 1 && report[1].unknown[0] === 'ghost', 'broken widget surfaces unknown plug')
ok(Object.isFrozen(report[0]), 'report rows frozen')

// --- generic over a CUSTOM catalog + available set (the widget→widget path) ---
const W2W = Object.freeze({
  'note-selection': Object.freeze({ scope: 'widget', summary: 'current note', keys: Object.freeze(['selectedNote']) }),
})
const w2wConn = resolveConnections(['note-selection'], ['note-selection'], W2W).connections
ok(w2wConn[0].connected, 'custom catalog + available connects a widget-provided interface')
ok(selectCtx({ selectedNote: 'x' }, w2wConn, W2W).selectedNote === 'x', 'custom catalog injects its own keys')
ok(setEq(appSlots({ selectedNote: 'x' }, W2W), []), 'appSlots ignores non-app scope (widget slots provided elsewhere)')

console.log(`connections: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
