// The widget↔app connection contract, tested from data alone — no React, no
// renderer, no running app. This is what the decoupling buys: every widget's
// declared `plugs` (manifest.js) is validated against the app interface catalog
// (connections.js), so a typo'd / retired / unsatisfiable interface fails CI
// instead of silently dropping a widget at runtime.
import { WIDGET_MANIFEST, WIDGET_MANIFEST_BY_TYPE, DEFAULT_BOARD, resolveWidgetConfig } from '../client/src/widgets/manifest.js'
import { APP_INTERFACES, resolveConnections, normalizePlugs } from '../client/src/connections.js'
import { DEFAULT_SIZE } from '../client/src/dashlayout.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// The app provides every interface its catalog defines (the canvas is the
// provider). Auto-connection resolves a widget's plugs against this set.
const APP_SLOTS = new Set(Object.keys(APP_INTERFACES))
const isPosInt = (n) => Number.isInteger(n) && n > 0
const isSize = (s) => s && isPosInt(s.w) && isPosInt(s.h)
// aspect is a ratio BAND (non-integer), unlike sizes which are whole grid cells.
const isAspect = (a) => a && typeof a.min === 'number' && typeof a.max === 'number' && a.min > 0 && a.max >= a.min
const inBand = (w, h, a) => { const r = w / h; return r >= a.min - 1e-9 && r <= a.max + 1e-9 }
const VALID_HANDLES = new Set(['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'])

// --- the manifest itself is well-formed ---
ok(Array.isArray(WIDGET_MANIFEST) && WIDGET_MANIFEST.length > 0, 'manifest is a non-empty array')
const types = WIDGET_MANIFEST.map((m) => m.type)
ok(new Set(types).size === types.length, 'widget types are unique')
ok(WIDGET_MANIFEST.every((m) => typeof m.type === 'string' && m.type), 'every widget has a non-empty type')
ok(WIDGET_MANIFEST.every((m) => typeof m.label === 'string' && m.label), 'every widget has a non-empty label')
ok(WIDGET_MANIFEST.every((m) => typeof m.desc === 'string' && m.desc), 'every widget has a one-line desc (shown in the Add-widget menu)')

// --- optional `mcp` toolset declarations (Settings toggles + server tool filter) ---
{
  const seen = new Set()
  for (const m of WIDGET_MANIFEST) {
    if (m.mcp === undefined) continue
    ok(typeof m.mcp.summary === 'string' && m.mcp.summary.length > 0, `${m.type}: mcp.summary is a non-empty string`)
    ok(Array.isArray(m.mcp.tools) && m.mcp.tools.length > 0, `${m.type}: mcp.tools is a non-empty array`)
    for (const name of (m.mcp.tools || [])) {
      ok(typeof name === 'string' && name.startsWith(m.type + '_'), `${m.type}: tool "${name}" is prefixed with the widget type`)
      ok(!seen.has(name), `${m.type}: tool "${name}" is unique across widgets`)
      seen.add(name)
    }
  }
}
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
// The host enforces a Wayland/ICCCM-style size contract: min/max floors+ceilings,
// an aspect band, and a resize policy. Validate the declared hints are well-formed
// and mutually consistent, and that a widget is BORN at a size satisfying them
// (aspect is only corrected on a user resize, so the initial size must already fit).
for (const m of WIDGET_MANIFEST) {
  if (m.defaultSize !== undefined) ok(isSize(m.defaultSize), `${m.type}: defaultSize is { w>0, h>0 } integers`)
  if (m.minSize !== undefined) ok(isSize(m.minSize), `${m.type}: minSize is { w>0, h>0 } integers`)
  if (m.maxSize !== undefined) ok(isSize(m.maxSize), `${m.type}: maxSize is { w>0, h>0 } integers`)
  if (isSize(m.defaultSize) && isSize(m.minSize)) {
    ok(m.defaultSize.w >= m.minSize.w && m.defaultSize.h >= m.minSize.h, `${m.type}: defaultSize is not smaller than minSize`)
  }
  if (isSize(m.maxSize) && isSize(m.minSize)) {
    ok(m.maxSize.w >= m.minSize.w && m.maxSize.h >= m.minSize.h, `${m.type}: maxSize is not smaller than minSize`)
  }
  // The size a widget is actually born at (its defaultSize, else the host default).
  const eff = { ...DEFAULT_SIZE, ...(m.defaultSize || {}) }
  if (isSize(m.maxSize)) {
    ok(eff.w <= m.maxSize.w && eff.h <= m.maxSize.h, `${m.type}: default size fits within maxSize`)
  }
  if (m.aspect !== undefined) {
    ok(isAspect(m.aspect), `${m.type}: aspect is { min>0, max>=min }`)
    if (isAspect(m.aspect)) ok(inBand(eff.w, eff.h, m.aspect), `${m.type}: default size satisfies its aspect band`)
  }
  if (m.resizable !== undefined) ok(typeof m.resizable === 'boolean', `${m.type}: resizable is a boolean`)
  if (m.resizeHandles !== undefined) {
    ok(Array.isArray(m.resizeHandles) && m.resizeHandles.length > 0 && m.resizeHandles.every((h) => VALID_HANDLES.has(h)),
      `${m.type}: resizeHandles is a non-empty subset of the 8 valid handles`)
  }
}

// --- optional per-instance `config` schemas (rendered as a generic form, saved
//     as w.config, delivered to the widget as the merged `config` prop) ---
const CONFIG_TYPES = new Set(['number', 'boolean', 'select', 'text'])
for (const m of WIDGET_MANIFEST) {
  if (m.config === undefined) continue
  ok(Array.isArray(m.config), `${m.type}: config is an array of field descriptors`)
  const keys = new Set()
  for (const f of (m.config || [])) {
    ok(f && typeof f.key === 'string' && f.key, `${m.type}: config field has a non-empty key`)
    ok(typeof f.label === 'string' && f.label, `${m.type}: config field "${f.key}" has a label`)
    ok(CONFIG_TYPES.has(f.type), `${m.type}: config field "${f.key}" has a known type (got: ${f.type})`)
    ok(f.default !== undefined, `${m.type}: config field "${f.key}" declares a default`)
    ok(!keys.has(f.key), `${m.type}: config key "${f.key}" is unique within the widget`)
    keys.add(f.key)
    if (f.type === 'number') {
      if (f.min !== undefined) ok(typeof f.min === 'number', `${m.type}.${f.key}: min is a number`)
      if (f.max !== undefined) ok(typeof f.max === 'number', `${m.type}.${f.key}: max is a number`)
      if (typeof f.min === 'number' && typeof f.max === 'number') ok(f.max >= f.min, `${m.type}.${f.key}: max >= min`)
      ok(typeof f.default === 'number', `${m.type}.${f.key}: number default is a number`)
      if (typeof f.min === 'number') ok(f.default >= f.min, `${m.type}.${f.key}: default >= min`)
      if (typeof f.max === 'number') ok(f.default <= f.max, `${m.type}.${f.key}: default <= max`)
    }
    if (f.type === 'boolean') ok(typeof f.default === 'boolean', `${m.type}.${f.key}: boolean default is a boolean`)
    if (f.type === 'select') {
      ok(Array.isArray(f.options) && f.options.length > 0, `${m.type}.${f.key}: select declares options`)
      ok((f.options || []).every((o) => o && o.value !== undefined && typeof o.label === 'string'), `${m.type}.${f.key}: each option has { value, label }`)
      ok((f.options || []).some((o) => o.value === f.default), `${m.type}.${f.key}: default is one of the options`)
    }
    if (f.type === 'text') ok(typeof f.default === 'string', `${m.type}.${f.key}: text default is a string`)
  }
  // The defaults must themselves validate against their own schema: resolving an
  // empty saved config yields exactly the declared defaults (round-trip identity).
  const resolvedDefaults = resolveWidgetConfig(m.config, undefined)
  for (const f of (m.config || [])) {
    ok(resolvedDefaults[f.key] === f.default, `${m.type}.${f.key}: default round-trips through resolveWidgetConfig`)
  }
}

// --- resolveWidgetConfig: merge/validate is total (never throws, always in-schema) ---
{
  const schema = [
    { key: 'n', label: 'N', type: 'number', default: 5, min: 1, max: 10 },
    { key: 'b', label: 'B', type: 'boolean', default: false },
    { key: 's', label: 'S', type: 'select', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { key: 't', label: 'T', type: 'text', default: '' },
  ]
  ok(JSON.stringify(resolveWidgetConfig(schema, undefined)) === JSON.stringify({ n: 5, b: false, s: 'a', t: '' }), 'resolve: missing saved -> all defaults')
  const merged = resolveWidgetConfig(schema, { b: true, t: 'hi', junk: 1 })
  ok(merged.b === true && merged.t === 'hi' && merged.n === 5 && merged.s === 'a', 'resolve: saved overlays defaults, gaps filled')
  ok(!('junk' in merged), 'resolve: keys not in the schema are dropped')
  ok(resolveWidgetConfig(schema, { n: 'not a number' }).n === 5, 'resolve: unparseable number -> default')
  ok(resolveWidgetConfig(schema, { n: 100 }).n === 10, 'resolve: out-of-range number is clamped to max')
  ok(resolveWidgetConfig(schema, { n: -3 }).n === 1, 'resolve: out-of-range number is clamped to min')
  ok(resolveWidgetConfig(schema, { b: 'yes' }).b === false, 'resolve: wrong-typed boolean -> default')
  ok(resolveWidgetConfig(schema, { s: 'zzz' }).s === 'a', 'resolve: unknown select option -> default')
  ok(resolveWidgetConfig(schema, { t: 42 }).t === '', 'resolve: wrong-typed text -> default')
  ok(JSON.stringify(resolveWidgetConfig(undefined, { a: 1 })) === '{}', 'resolve: no schema -> {}')
  ok(JSON.stringify(resolveWidgetConfig(schema, null)) === JSON.stringify({ n: 5, b: false, s: 'a', t: '' }), 'resolve: null saved -> defaults (no throw)')
}

// --- the default board only references real widgets ---
ok(DEFAULT_BOARD.length > 0, 'default board is non-empty')
ok(DEFAULT_BOARD.every((t) => WIDGET_MANIFEST_BY_TYPE.has(t)), 'every default-board type exists in the manifest')

console.log(`widget-contract: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
