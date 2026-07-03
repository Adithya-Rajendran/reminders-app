// Unit tests for the omnibox ranking (client/src/omnibox.js). Pure module, runs in
// plain Node. Run with: node test/omnibox.test.mjs
import { rankEntries, KIND_WEIGHT } from '../client/src/omnibox.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const E = [
  { kind: 'command', id: 'c1', title: 'Open Settings', keys: ['Open Settings', 'settings', 'preferences'], priority: 1 },
  { kind: 'nav', id: 'n1', title: 'Go to Prioritize', keys: ['Go to Prioritize', 'Prioritize', 'triage', 'eisenhower'], priority: 2 },
  { kind: 'nav', id: 'n2', title: 'Go to Calendar', keys: ['Go to Calendar', 'Calendar', 'events'], priority: 2 },
  { kind: 'task', id: 't1', title: 'Call the plumber' },
  { kind: 'task', id: 't2', title: 'Prioritize Q3 roadmap' },
  { kind: 'note', id: 'no1', title: 'Meeting notes' },
]
const idAt = (rs, i) => rs[i] && rs[i].item.id

// ---- blank query: the palette owns the empty state, not rankEntries ----
ok(rankEntries('', E).length === 0, 'blank query returns nothing')
ok(rankEntries('   ', E).length === 0, 'whitespace-only query returns nothing')
ok(rankEntries('a', null).length === 0, 'null entries → empty (no throw)')

// ---- renamed-surface alias (the #1 fixed friction) ----
const triage = rankEntries('triage', E)
ok(idAt(triage, 0) === 'n1', 'the query "triage" finds the renamed "Prioritize" surface via alias')
ok(triage[0].viaAlias === true, 'the alias hit is flagged viaAlias')
ok(triage[0].positions.length === 0, 'an alias-only hit carries NO title highlight positions')

// ---- a title match keeps its highlight even when an alias scores higher ----
const cal = rankEntries('calendar', E)
ok(idAt(cal, 0) === 'n2', '"calendar" finds the Calendar nav entry')
ok(cal[0].viaAlias === false && cal[0].positions.length > 0, 'a title match carries highlight positions')

// ---- content search: a task is findable by its own title ----
const plumber = rankEntries('plumber', E)
ok(plumber.length === 1 && idAt(plumber, 0) === 't1', 'a task is found by its title content')

// ---- cross-type ordering: a precise command/nav match leads a weak content match ----
const settings = rankEntries('settings', E)
ok(idAt(settings, 0) === 'c1', '"settings" leads with the Settings command over content')

// ---- drops non-matches ----
ok(rankEntries('zzzzz', E).length === 0, 'no matches → empty list')

// ---- entries without an explicit `keys` fall back to matching the title ----
const bare = rankEntries('meet', [{ kind: 'note', id: 'x', title: 'Meeting notes' }])
ok(bare.length === 1 && bare[0].positions.length > 0, 'missing keys → title is the match key (with highlight)')

// ---- kind weight sanity ----
ok(KIND_WEIGHT.command > KIND_WEIGHT.task && KIND_WEIGHT.nav > KIND_WEIGHT.note, 'command/nav weigh above task/note')

console.log(`\nomnibox.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
