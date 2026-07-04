// Surface aliases (client/src/palettecmds.js): the omnibox resolves a widget
// surface by the word a user types, including the OLD name of a renamed surface.
// Run with: node test/palettecmds.test.mjs
import { aliasesForType, SURFACE_ALIASES } from '../client/src/palettecmds.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- surface aliases (renamed-surface omnibox fix) ---
ok(aliasesForType('triage').includes('triage'), 'the renamed Prioritize surface still answers to "triage"')
ok(aliasesForType('triage').includes('prioritize'), 'triage aliases include the new name too')
ok(aliasesForType('overview').includes('home') && aliasesForType('overview').includes('today'), 'overview aliases cover common synonyms')
ok(Array.isArray(aliasesForType('does-not-exist')) && aliasesForType('does-not-exist').length === 0, 'an unknown type yields an empty alias list (no throw)')
ok(Object.keys(SURFACE_ALIASES).every((t) => Array.isArray(SURFACE_ALIASES[t]) && SURFACE_ALIASES[t].length > 0), 'every mapped surface has at least one alias')

console.log(`palettecmds: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
