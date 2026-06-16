// Tests for wikilink helpers (client/src/wikilinks.js). Pure module. Run with:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/wikilinks.test.mjs
import { WIKILINK_RE, parseWikilink, serializeWikilink, wikilinkLabel, resolveWikilink } from '../client/src/wikilinks.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- parse / serialize ----
ok(parseWikilink('Title').target === 'Title' && parseWikilink('Title').alias === '', 'parse: plain target')
ok(parseWikilink('Title|Alias').alias === 'Alias', 'parse: alias')
ok(parseWikilink('  A | B ').target === 'A' && parseWikilink('  A | B ').alias === 'B', 'parse: trims')
ok(serializeWikilink({ target: 'Title' }) === '[[Title]]', 'serialize: plain')
ok(serializeWikilink({ target: 'Title', alias: 'Alias' }) === '[[Title|Alias]]', 'serialize: alias')
// disk identity (the round-trip that protects portability)
const inners = ['Title', 'Title|Alias', 'My Note', 'Folder Thing|shown']
for (const inner of inners) ok(serializeWikilink(parseWikilink(inner)) === `[[${inner.split('|').map((s) => s.trim()).join('|')}]]`, `round-trip: ${inner}`)
ok(wikilinkLabel('Page|Shown') === 'Shown', 'label: alias wins')
ok(wikilinkLabel('Page') === 'Page', 'label: target when no alias')

// ---- regex ----
const all = (s) => { WIKILINK_RE.lastIndex = 0; return [...s.matchAll(WIKILINK_RE)].map((m) => m[1]) }
ok(all('see [[A]] and [[B|b]] here').join() === 'A,B|b', 'regex: finds multiple links')
ok(all('no links').length === 0, 'regex: none')

// ---- resolveWikilink ----
const notes = [
  { title: 'Roadmap', path: 'Notes/Roadmap.md', folder: '', updated: '2026-01-01' },
  { title: 'Roadmap', path: 'Notes/Work/Roadmap.md', folder: 'Work', updated: '2026-06-01' },
  { title: 'Ideas', path: 'Notes/Ideas.md', folder: '', updated: '2026-03-01' },
]
ok(resolveWikilink('ideas', notes).path === 'Notes/Ideas.md', 'resolve: case-insensitive title match')
ok(resolveWikilink('Nope', notes) === null, 'resolve: no match -> null')
ok(resolveWikilink('Roadmap', notes, 'Work').path === 'Notes/Work/Roadmap.md', 'resolve: tie-break prefers same folder')
ok(resolveWikilink('Roadmap', notes, 'Other').path === 'Notes/Work/Roadmap.md', 'resolve: tie-break then most-recent')

console.log(`\nwikilinks.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
