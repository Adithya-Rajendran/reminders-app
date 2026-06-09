// Characterization tests for the notes storage layer: front-matter parse/
// serialize (notes.js) and WebDAV path building + PROPFIND parsing (webdav.js).
// Importing these pulls in config.js (opens SQLite at import), so point it at a
// throwaway file. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_DB_PATH=/tmp/notes.test.db node:22 node test/notes.test.mjs
import { rmSync } from 'node:fs'
process.env.CONFIG_STORE = 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/notes.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const { parseNote, serializeNote, sanitizeFolder, inRoot } = await import('../server/notes.js')
const { filesBase, davUrl, parsePropfind, asMatch } = await import('../server/webdav.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const ACC = { server_url: 'https://nc.example.com/remote.php/dav', username: 'alex' }

// ---- front-matter ----
{
  const md = serializeNote({ id: 'abc', created: '2026-06-09T00:00:00Z' }, '# Hello\n\nbody **bold**\n')
  ok(md.startsWith('---\n') && md.includes('id: abc'), 'serializeNote emits a YAML front-matter block')
  const { meta, body } = parseNote(md)
  ok(meta.id === 'abc' && meta.created === '2026-06-09T00:00:00Z', 'parseNote round-trips the front-matter')
  ok(body === '# Hello\n\nbody **bold**\n', 'parseNote returns the body verbatim')
}
{
  const { meta, body } = parseNote('no front matter here\n# Title')
  ok(Object.keys(meta).length === 0, 'a note with no front-matter yields empty meta')
  ok(body === 'no front matter here\n# Title', 'body is preserved when there is no front-matter')
}
{
  // a body that itself contains a --- horizontal rule must not be mistaken for fm
  const md = serializeNote({ id: 'x' }, 'para\n\n---\n\nmore')
  const { meta, body } = parseNote(md)
  ok(meta.id === 'x' && body === 'para\n\n---\n\nmore', 'a --- rule inside the body is not parsed as front-matter')
}
{
  const { meta } = parseNote('---\n: : : not yaml\n---\nbody')
  ok(typeof meta === 'object' && !Array.isArray(meta), 'malformed YAML front-matter degrades to an empty object, not a throw')
}

{
  const md = serializeNote({ id: 'x', tags: ['work', 'ideas'] }, '# T\n')
  const { meta, body } = parseNote(md)
  ok(Array.isArray(meta.tags) && meta.tags.join(',') === 'work,ideas', 'front-matter tags round-trip as a YAML list')
  ok(meta.id === 'x' && body === '# T\n', 'tags coexist with id + body')
}

// ---- path-traversal guards (security) ----
ok(sanitizeFolder('../Evil') === 'Evil', 'sanitizeFolder strips a leading .. segment')
ok(sanitizeFolder('a/../../b') === 'a/b', 'sanitizeFolder drops every .. segment')
ok(sanitizeFolder('./x/.') === 'x', 'sanitizeFolder drops . segments')
ok(sanitizeFolder('..') === '', 'sanitizeFolder of just .. is empty')
ok(inRoot('Notes', 'Notes/a.md') === true, 'inRoot allows paths inside the root')
ok(inRoot('Notes', 'Other/a.md') === false, 'inRoot rejects a sibling root')
ok(inRoot('Notes', 'Notes/../Other/a.md') === false, 'inRoot rejects .. traversal even under the root prefix')
ok(inRoot('Notes', 'NotesEvil/a.md') === false, 'inRoot is not fooled by a root-name prefix')

// ---- webdav path building ----
ok(filesBase(ACC) === 'https://nc.example.com/remote.php/dav/files/alex/', 'filesBase points at the user Files endpoint')
ok(davUrl(ACC, 'Notes/My note.md') === 'https://nc.example.com/remote.php/dav/files/alex/Notes/My%20note.md', 'davUrl percent-encodes spaces, keeps slashes')
ok(davUrl(ACC, '/Notes/', true).endsWith('/Notes/'), 'collection URLs keep a single trailing slash')
ok(davUrl(ACC, 'Notes/file.md', false) === davUrl(ACC, 'Notes/file.md'), 'file URLs have no trailing slash by default')
ok(davUrl(ACC, 'a/b c/d&e.md').includes('b%20c/d%26e.md'), 'special chars (& and space) are encoded, path separators are not')

// ---- If-Match quoting (Nextcloud rejects unquoted conditional headers) ----
ok(asMatch('abc123') === '"abc123"', 'asMatch quotes a bare etag for If-Match')
ok(asMatch('*') === '*', 'asMatch leaves * verbatim (If-None-Match: *)')
ok(asMatch('"already"') === '"already"', 'asMatch leaves an already-quoted etag alone')
ok(asMatch('W/"weak"') === 'W/"weak"', 'asMatch leaves a weak etag alone')
ok(asMatch(undefined) === undefined && asMatch('') === '', 'asMatch passes through empty/undefined')

// ---- PROPFIND parse (sample Nextcloud multistatus) ----
{
  const xml = `<?xml version="1.0"?>
  <d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
    <d:response><d:href>/remote.php/dav/files/alex/Notes/</d:href><d:propstat><d:prop>
      <d:resourcetype><d:collection/></d:resourcetype><d:getetag>"dir1"</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
    <d:response><d:href>/remote.php/dav/files/alex/Notes/My%20note.md</d:href><d:propstat><d:prop>
      <d:resourcetype/><d:getetag>"abc123"</d:getetag>
      <d:getlastmodified>Tue, 09 Jun 2026 00:00:00 GMT</d:getlastmodified>
      <d:getcontentlength>42</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  </d:multistatus>`
  const rows = parsePropfind(xml, ACC)
  ok(rows.length === 2, 'parsePropfind returns one row per <response>')
  const dir = rows.find((r) => r.path === 'Notes')
  const file = rows.find((r) => r.path === 'Notes/My note.md')
  ok(dir && dir.isDir === true, 'a collection is flagged isDir and its href is made relative to the files base')
  ok(file && file.isDir === false, 'a plain file is not isDir')
  ok(file && file.etag === 'abc123', 'getetag is unquoted')
  ok(file && file.name === 'My note.md', 'href is percent-decoded into a relative path + name')
  ok(file && file.size === 42 && /^2026-06-09/.test(file.mtime), 'size + last-modified are parsed')
}

console.log(`\nnotes.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
