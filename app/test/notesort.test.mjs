// Tests for note sort orders (client/src/notesort.js). Pure. Run:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/notesort.test.mjs
import { SORTS, sortNotes } from '../client/src/notesort.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const notes = [
  { title: 'Banana', created: '2026-01-01', updated: '2026-06-03' },
  { title: 'apple', created: '2026-03-01', updated: '2026-06-01' },
  { title: 'Cherry', created: '2026-02-01', updated: '2026-06-02' },
]
const t = (key) => sortNotes(notes, key).map((n) => n.title)

ok(SORTS.length === 4, 'four sort orders')
ok(t('updated').join() === 'Banana,Cherry,apple', 'updated: newest first')
ok(t('created').join() === 'apple,Cherry,Banana', 'created: newest first')
ok(t('title-asc').join() === 'apple,Banana,Cherry', 'title A-Z (case-insensitive)')
ok(t('title-desc').join() === 'Cherry,Banana,apple', 'title Z-A')
ok(t('bogus').join() === t('updated').join(), 'unknown key falls back to updated')

// non-mutating
const orig = notes.slice()
sortNotes(notes, 'title-asc')
ok(notes.map((n) => n.title).join() === orig.map((n) => n.title).join(), 'does not mutate the input')

console.log(`\nnotesort.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
