// The widget↔app connection contract, tested from data alone — no React, no
// renderer, no running app. This is what the decoupling buys: every widget's
// declared `plugs` (manifest.js) is validated against the app interface catalog
// (connections.js), so a typo'd / retired / unsatisfiable interface fails CI
// instead of silently dropping a widget at runtime.
import { WIDGET_MANIFEST, WIDGET_MANIFEST_BY_TYPE, DEFAULT_BOARD } from '../client/src/widgets/manifest.js'
import { APP_INTERFACES, resolveConnections, normalizePlugs } from '../client/src/connections.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// The app provides every interface its catalog defines (the canvas is the
// provider). Auto-connection resolves a widget's plugs against this set.
const APP_SLOTS = new Set(Object.keys(APP_INTERFACES))
const isPosInt = (n) => Number.isInteger(n) && n > 0
const isSize = (s) => s && isPosInt(s.w) && isPosInt(s.h)

// --- the manifest itself is well-formed ---
ok(Array.isArray(WIDGET_MANIFEST) && WIDGET_MANIFEST.length > 0, 'manifest is a non-empty array')
const types = WIDGET_MANIFEST.map((m) => m.type)
ok(new Set(types).size === types.length, 'widget types are unique')
ok(WIDGET_MANIFEST.every((m) => typeof m.type === 'string' && m.type), 'every widget has a non-empty type')
ok(WIDGET_MANIFEST.every((m) => typeof m.label === 'string' && m.label), 'every widget has a non-empty label')
ok(WIDGET_MANIFEST_BY_TYPE.size === WIDGET_MANIFEST.length && types.every((t) => WIDGET_MANIFEST_BY_TYPE.get(t)), 'by-type index matches the manifest')

// --- the connection contract: every plug resolves against the app catalog ---
for (const m of WIDGET_MANIFEST) {
  ok(Array.isArray(m.plugs), `${m.type}: plugs is an array`)
  const { unknown, missing } = resolveConnections(m.plugs, APP_SLOTS)
  ok(unknown.length === 0, `${m.type}: no unknown interfaces (got: ${unknown.join(', ') || 'none'})`)
  ok(missing.length === 0, `${m.type}: every required interface is provided by the app (missing: ${missing.join(', ') || 'none'})`)
  // No accidental duplicate plug declarations (normalize dedupes — compare counts).
  ok(normalizePlugs(m.plugs).length === (m.plugs || []).length, `${m.type}: no duplicate plug declarations`)
  // Widgets only plug into app-scope interfaces today (widget→widget comes later).
  ok((m.plugs || []).every((p) => APP_INTERFACES[typeof p === 'string' ? p : p.interface]?.scope === 'app'), `${m.type}: all plugs are app-scope interfaces`)
}

// --- declared capability requirements are well-formed (manifest.requires) ---
const KNOWN_CAPABILITIES = new Set(['caldav', 'nextcloud'])
for (const m of WIDGET_MANIFEST) {
  if (m.requires !== undefined) {
    ok(Array.isArray(m.requires) && m.requires.every((r) => KNOWN_CAPABILITIES.has(r)),
      `${m.type}: requires is an array of known capabilities (got: ${JSON.stringify(m.requires)})`)
  }
}

// --- layout sizing is sane (these feed dashlayout via WIDGET_TYPES) ---
for (const m of WIDGET_MANIFEST) {
  if (m.defaultSize !== undefined) ok(isSize(m.defaultSize), `${m.type}: defaultSize is { w>0, h>0 } integers`)
  if (m.minSize !== undefined) ok(isSize(m.minSize), `${m.type}: minSize is { w>0, h>0 } integers`)
  if (isSize(m.defaultSize) && isSize(m.minSize)) {
    ok(m.defaultSize.w >= m.minSize.w && m.defaultSize.h >= m.minSize.h, `${m.type}: defaultSize is not smaller than minSize`)
  }
}

// --- the default board only references real widgets ---
ok(DEFAULT_BOARD.length > 0, 'default board is non-empty')
ok(DEFAULT_BOARD.every((t) => WIDGET_MANIFEST_BY_TYPE.has(t)), 'every default-board type exists in the manifest')

console.log(`widget-contract: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
