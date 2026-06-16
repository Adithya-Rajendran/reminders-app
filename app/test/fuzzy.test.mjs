// Unit tests for the fuzzy matcher (client/src/fuzzy.js). Pure module, runs in
// plain Node. Run with:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/fuzzy.test.mjs
import { fuzzyMatch, fuzzyRank } from '../client/src/fuzzy.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- subsequence semantics ----
ok(fuzzyMatch('abc', 'aXbXc') !== null, 'matches an in-order subsequence')
ok(fuzzyMatch('abc', 'acb') === null, 'non-subsequence (wrong order) returns null')
ok(fuzzyMatch('xyz', 'abc') === null, 'absent chars return null')
ok(fuzzyMatch('', 'anything').score === 0, 'empty query scores 0 (matches everything)')
ok(fuzzyMatch('Notes', 'notes') !== null, 'case-insensitive')

// ---- positions ----
ok(fuzzyMatch('ab', 'xaxb').positions.join() === '1,3', 'positions are the matched indices')
ok(fuzzyMatch('no', 'notes').positions.join() === '0,1', 'consecutive prefix positions')

// ---- scoring properties ----
const sc = (q, t) => fuzzyMatch(q, t).score
ok(sc('abc', 'abcd') > sc('abc', 'axbxc'), 'consecutive run beats a scattered match')
ok(sc('no', 'notes') > sc('no', 'kanote'), 'prefix beats a mid-word match')
ok(sc('fb', 'foo bar') > sc('fb', 'foobar'), 'word-boundary match beats a non-boundary one')
ok(sc('cp', 'CommandPalette') > 0 && fuzzyMatch('cp', 'CommandPalette') !== null, 'camelCase humps count as boundaries')
ok(sc('ab', 'ab') > sc('ab', 'abc'), 'shorter/denser text wins ties')

// ---- ranking ----
const rank = (q, arr) => fuzzyRank(q, arr).map((r) => r.item)
ok(rank('me', ['Meeting notes', 'My eggs', 'Random']).length === 2, 'drops non-matches')
ok(rank('proj', ['Side project', 'Project plan', 'projector'])[0] === 'Project plan' || rank('proj', ['Side project', 'Project plan', 'projector'])[0] === 'projector', 'a boundary/prefix match ranks first')
ok(fuzzyRank('', ['a', 'b', 'c']).length === 3, 'empty query returns every item')
ok(fuzzyRank('', ['a', 'b', 'c']).map((r) => r.item).join() === 'a,b,c', 'empty query keeps original order')

// ranking with a key function over objects
const items = [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Alfalfa' }]
ok(fuzzyRank('al', items, (x) => x.title).length === 2, 'fuzzyRank uses keyFn over objects')

console.log(`\nfuzzy.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
