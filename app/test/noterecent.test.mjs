// Tests for the recent-notes ring buffer (client/src/noterecent.js). Pure. Run:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/noterecent.test.mjs
import { pushRecent, pruneRecent } from '../client/src/noterecent.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const paths = (l) => l.map((x) => x.path).join()

ok(paths(pushRecent([], { path: 'a.md', title: 'A' })) === 'a.md', 'pushes onto an empty list')
ok(paths(pushRecent([{ path: 'a.md' }], { path: 'b.md' })) === 'b.md,a.md', 'newest goes to the front')
ok(paths(pushRecent([{ path: 'a.md' }, { path: 'b.md' }], { path: 'b.md' })) === 'b.md,a.md', 're-opening moves it to the front (de-dupe)')

let l = []
for (let i = 0; i < 12; i++) l = pushRecent(l, { path: 'n' + i + '.md' })
ok(l.length === 8, 'capped at 8 by default')
ok(l[0].path === 'n11.md', 'most-recent first after cap')

ok(pushRecent([], { title: 'no path' }).length === 0, 'ignores an entry without a path')

const input = [{ path: 'a.md' }]
pushRecent(input, { path: 'b.md' })
ok(paths(input) === 'a.md', 'does not mutate the input list')

ok(paths(pruneRecent([{ path: 'a.md' }, { path: 'gone.md' }], new Set(['a.md']))) === 'a.md', 'prunes notes that no longer exist')

console.log(`\nnoterecent.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
