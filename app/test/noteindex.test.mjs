// Tests for the note search/link index (server/noteindex.js): pure query/link
// helpers plus an in-process SQLite (FTS5) smoke test. Importing pulls in
// config.js (opens SQLite at import), so point it at a throwaway file. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_DB_PATH=/tmp/noteindex.test.db node:22 node test/noteindex.test.mjs
import { rmSync } from 'node:fs'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/noteindex.test.db'
for (const ext of ['', '-wal', '-shm']) rmSync(process.env.CONFIG_DB_PATH + ext, { force: true })

const { extractLinks, stripMarkdownForIndex, buildFtsQuery, segmentSnippet,
  reindexNote, removeNote, pruneMissing, search, backlinks, clearUser } = await import('../server/noteindex.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- extractLinks ----
ok(extractLinks('see [[Alpha]] and [[Beta]]').map((l) => l.target).join() === 'alpha,beta', 'extractLinks: two links')
ok(extractLinks('[[Title|Alias]]')[0].target === 'title', 'extractLinks: alias dropped from target')
ok(extractLinks('[[Title|Alias]]')[0].raw === 'Title|Alias', 'extractLinks: raw keeps alias')
ok(extractLinks('```\n[[NotALink]]\n```').length === 0, 'extractLinks: fenced code ignored')
ok(extractLinks('`[[NotALink]]`').length === 0, 'extractLinks: inline code ignored')
ok(extractLinks('[[Dup]] [[dup]]').length === 1, 'extractLinks: de-dupes by normalized target')
ok(extractLinks('no links here').length === 0, 'extractLinks: none')

// ---- stripMarkdownForIndex ----
ok(!stripMarkdownForIndex('---\nid: 1\n---\nhello').includes('id'), 'strip: frontmatter removed')
ok(stripMarkdownForIndex('# Heading') === 'Heading', 'strip: heading marker removed')
ok(stripMarkdownForIndex('[text](http://x)') === 'text', 'strip: link text kept, url dropped')
ok(stripMarkdownForIndex('[[Page|Shown]]') === 'Shown', 'strip: wikilink alias kept')
ok(!stripMarkdownForIndex('![alt](img.png)').includes('img'), 'strip: image dropped')

// ---- buildFtsQuery ----
ok(buildFtsQuery('') === null, 'fts query: empty -> null')
ok(buildFtsQuery('   ') === null, 'fts query: blanks -> null')
ok(buildFtsQuery('foo') === '"foo"*', 'fts query: single term gets prefix *')
ok(buildFtsQuery('foo bar') === '"foo" "bar"*', 'fts query: multi term, last is prefix')
ok(!buildFtsQuery('a"b OR c').includes('"b OR'), 'fts query: quotes stripped (injection-safe)')
ok(buildFtsQuery('"); drop') !== null && !buildFtsQuery('"); drop').includes(');'), 'fts query: punctuation neutralized')

// ---- segmentSnippet ----
const STX = String.fromCharCode(2), ETX = String.fromCharCode(3) // = SQL char(2)/char(3)
const seg = segmentSnippet('pre' + STX + 'HIT' + ETX + 'post')
ok(seg.length === 3 && seg[1].hit === true && seg[1].t === 'HIT', 'segmentSnippet: marks -> hit segment')
ok(segmentSnippet('plain').length === 1 && segmentSnippet('plain')[0].hit === false, 'segmentSnippet: no marks -> single plain seg')

// ---- SQLite smoke (FTS5) ----
const U = 'user-A', V = 'user-B'
reindexNote(U, { path: 'Notes/Meeting.md', title: 'Meeting', folder: '', body: 'discuss the quarterly budget and [[Roadmap]]' })
reindexNote(U, { path: 'Notes/Roadmap.md', title: 'Roadmap', folder: '', body: 'the product roadmap for next year' })
reindexNote(V, { path: 'Notes/Secret.md', title: 'Secret', folder: '', body: 'user B private budget note' })

const r = search(U, 'budget')
ok(r.length === 1 && r[0].path === 'Notes/Meeting.md', 'search: finds body match for user A')
ok(r[0].snippet.some((s) => s.hit && /budget/i.test(s.t)), 'search: snippet highlights the match')
ok(search(U, 'roadmap').length >= 1, 'search: title + body match')
ok(search(U, 'budget').every((x) => x.path !== 'Notes/Secret.md'), 'search: user isolation — A cannot see B')
ok(search(V, 'budget').length === 1 && search(V, 'budget')[0].path === 'Notes/Secret.md', 'search: user B sees only their own')
ok(search(U, '"); DROP TABLE note_fts; --').length === 0, 'search: injection string is safe (no throw, no results)')

// backlinks: Meeting links to Roadmap
ok(backlinks(U, 'Roadmap').length === 1 && backlinks(U, 'Roadmap')[0].path === 'Notes/Meeting.md', 'backlinks: Roadmap is linked from Meeting')
ok(backlinks(V, 'Roadmap').length === 0, 'backlinks: user isolation')

// updating a note re-indexes cleanly (stale content gone, new content searchable)
reindexNote(U, { path: 'Notes/Meeting.md', title: 'Meeting', folder: '', body: 'now about hiring plans' })
ok(search(U, 'budget').length === 0, 'reindex: stale content removed')
ok(search(U, 'hiring').length === 1, 'reindex: new content searchable')
ok(backlinks(U, 'Roadmap').length === 0, 'reindex: removed link no longer a backlink')

// remove + prune
removeNote(U, 'Notes/Roadmap.md')
ok(search(U, 'roadmap').length === 0, 'removeNote: gone from index')
reindexNote(U, { path: 'Notes/Keep.md', title: 'Keep', folder: '', body: 'keep me here' })
pruneMissing(U, new Set(['Notes/Keep.md']))
ok(search(U, 'hiring').length === 0, 'pruneMissing: drops notes not in the seen set')
ok(search(U, 'keep').length === 1, 'pruneMissing: keeps notes in the seen set')

// clearUser wipes only that user
clearUser(U)
ok(search(U, 'keep').length === 0, 'clearUser: wipes the user index')
ok(search(V, 'budget').length === 1, 'clearUser: other users untouched')

console.log(`\nnoteindex.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
