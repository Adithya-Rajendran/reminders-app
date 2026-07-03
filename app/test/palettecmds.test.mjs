// Palette command ordering (client/src/palettecmds.js): priority leads on an
// empty query, fuzzy score dominates with a query (priority only nudges).
// Run with: node test/palettecmds.test.mjs
import { orderCommands, aliasesForType, SURFACE_ALIASES } from '../client/src/palettecmds.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- surface aliases (renamed-surface omnibox fix) ---
ok(aliasesForType('triage').includes('triage'), 'the renamed Prioritize surface still answers to "triage"')
ok(aliasesForType('triage').includes('prioritize'), 'triage aliases include the new name too')
ok(aliasesForType('overview').includes('home') && aliasesForType('overview').includes('today'), 'overview aliases cover common synonyms')
ok(Array.isArray(aliasesForType('does-not-exist')) && aliasesForType('does-not-exist').length === 0, 'an unknown type yields an empty alias list (no throw)')
ok(Object.keys(SURFACE_ALIASES).every((t) => Array.isArray(SURFACE_ALIASES[t]) && SURFACE_ALIASES[t].length > 0), 'every mapped surface has at least one alias')
const r = (id, score = 0, priority) => ({ item: { id, ...(priority !== undefined ? { priority } : {}) }, score, positions: [] })
const ids = (list) => list.map((x) => x.item.id).join(',')

// --- empty query: priority desc, stable within a tier ---
const empty = orderCommands([r('logout', 0, -1), r('theme', 0), r('capture', 0, 3), r('goto-a', 0, 2), r('goto-b', 0, 2), r('settings', 0, 1)], '')
ok(ids(empty) === 'capture,goto-a,goto-b,settings,theme,logout', 'priority orders the empty-query list; ties keep registration order')

// --- with a query: score dominates, priority nudges near-ties ---
const scored = orderCommands([r('low-pri-high-score', 10, 0), r('high-pri-low-score', 2, 3)], 'x')
ok(ids(scored) === 'low-pri-high-score,high-pri-low-score', 'a clearly better fuzzy match beats priority')
const nearTie = orderCommands([r('plain', 5, 0), r('boosted', 5, 2)], 'x')
ok(ids(nearTie) === 'boosted,plain', 'priority breaks score ties')

// --- input is not mutated ---
const input = [r('a', 0, 0), r('b', 0, 1)]
orderCommands(input, '')
ok(input[0].item.id === 'a', 'orderCommands does not mutate its input array')

console.log(`palettecmds: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
