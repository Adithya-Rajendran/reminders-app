// Full-text search + wikilink index for notes, kept in the app's existing SQLite
// store (config.js). This is derived, cheap-to-recreate data: it is rebuilt
// lazily from the WebDAV walk in notes.listNotes (reusing the etag-diff: only a
// changed note's body is re-read, so steady-state indexing costs ~0 extra reads)
// and cleared per-user when they point notes at a different WebDAV.
//
// The pure helpers (extractLinks / stripMarkdownForIndex / buildFtsQuery /
// segmentSnippet) carry no DB dependency so the node tests can exercise them.
import { sqlite } from './config.js'

const STX = '\u0002', ETX = '\u0003' // snippet highlight sentinels = SQL char(2)/char(3)

// ---- pure helpers ----

// Find every [[wikilink]] in a note body, skipping fenced + inline code so a
// literal `[[x]]` in a code sample isn't treated as a link. Targets are
// normalized (alias dropped, lowercased, whitespace-collapsed) and de-duped.
export function extractLinks(body) {
  const lines = String(body || '').split('\n')
  const out = []
  const seen = new Set()
  let inFence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const clean = line.replace(/`[^`]*`/g, ' ') // strip inline code spans
    const re = /\[\[([^\]\n]+?)\]\]/g
    let m
    while ((m = re.exec(clean)) !== null) {
      const inner = m[1]
      const target = inner.split('|')[0].trim().replace(/\s+/g, ' ').toLowerCase()
      if (!target || seen.has(target)) continue
      seen.add(target)
      out.push({ target, raw: inner.trim(), context: clean.trim().slice(0, 160) })
    }
  }
  return out
}

// Reduce a markdown body to readable words for the FTS index: drop frontmatter,
// fence markers and images; unwrap links/wikilinks to their text; strip block
// and inline markers. Not a full parser — just denoising so search matches words.
export function stripMarkdownForIndex(body) {
  let s = String(body || '')
  s = s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')            // frontmatter
  s = s.replace(/^[ \t]*(```|~~~).*$/gm, '')                     // fence lines (keep code text)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                    // images
  s = s.replace(/\[\[([^\]\n]+?)\]\]/g, (_, inner) => { const p = inner.split('|'); return p.length > 1 ? p.slice(1).join('|') : p[0] })
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                  // [text](url) -> text
  s = s.replace(/^[ \t]*([#>*+-]|\d+\.)[ \t]+/gm, '')           // heading/quote/list markers
  s = s.replace(/[*_~`]+/g, '')                                  // emphasis / code marks
  return s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

// Turn a raw user query into a safe FTS5 MATCH expression: each whitespace term
// is quoted (neutralizing FTS operators / injection) and the last gets a `*`
// prefix so search-as-you-type matches partial words. Returns null when empty.
export function buildFtsQuery(q) {
  const terms = String(q || '').toLowerCase().split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
  if (!terms.length) return null
  return terms.map((t, i) => `"${t}"${i === terms.length - 1 ? '*' : ''}`).join(' ')
}

// Split an FTS snippet (with STX/ETX-bracketed matches) into React-safe segments
// [{ t, hit }] — so the client renders <mark> without dangerouslySetInnerHTML.
export function segmentSnippet(str, open = STX, close = ETX) {
  const s = String(str == null ? '' : str)
  const out = []
  let i = 0
  while (i < s.length) {
    const o = s.indexOf(open, i)
    if (o === -1) { out.push({ t: s.slice(i), hit: false }); break }
    if (o > i) out.push({ t: s.slice(i, o), hit: false })
    const c = s.indexOf(close, o + open.length)
    if (c === -1) { out.push({ t: s.slice(o + open.length), hit: true }); break }
    out.push({ t: s.slice(o + open.length, c), hit: true })
    i = c + close.length
  }
  return out.filter((seg) => seg.t !== '')
}

// ---- SQLite ops (prepared lazily so table creation in config.js has run) ----
let st = null
function stmts() {
  if (st) return st
  st = {
    delFts: sqlite.prepare('DELETE FROM note_fts WHERE user_id = ? AND path = ?'),
    insFts: sqlite.prepare('INSERT INTO note_fts (body, title, folder, path, user_id) VALUES (?,?,?,?,?)'),
    delLinks: sqlite.prepare('DELETE FROM note_links WHERE user_id = ? AND src_path = ?'),
    insLink: sqlite.prepare('INSERT OR IGNORE INTO note_links (user_id, src_path, target, raw, context) VALUES (?,?,?,?,?)'),
    paths: sqlite.prepare('SELECT path FROM note_fts WHERE user_id = ?'),
    delUserFts: sqlite.prepare('DELETE FROM note_fts WHERE user_id = ?'),
    delUserLinks: sqlite.prepare('DELETE FROM note_links WHERE user_id = ?'),
    search: sqlite.prepare(
      `SELECT path, title, folder, snippet(note_fts, 0, char(2), char(3), '…', 12) AS snip
       FROM note_fts WHERE note_fts MATCH ? AND user_id = ?
       ORDER BY bm25(note_fts, 1.0, 4.0, 0.0, 0.0, 0.0) LIMIT ?`),
    backlinks: sqlite.prepare('SELECT src_path, raw, context FROM note_links WHERE user_id = ? AND target = ? ORDER BY src_path'),
  }
  return st
}

const _reindex = sqlite.transaction((userId, n) => {
  const q = stmts()
  q.delFts.run(userId, n.path)
  q.insFts.run(stripMarkdownForIndex(n.body || ''), n.title || '', n.folder || '', n.path, userId)
  q.delLinks.run(userId, n.path)
  for (const l of extractLinks(n.body || '')) q.insLink.run(userId, n.path, l.target, l.raw, l.context || '')
})
const _remove = sqlite.transaction((userId, path) => { const q = stmts(); q.delFts.run(userId, path); q.delLinks.run(userId, path) })
const _clear = sqlite.transaction((userId) => { const q = stmts(); q.delUserFts.run(userId); q.delUserLinks.run(userId) })

// Re-index one note (n: { path, title, folder, body }). Best-effort: a bad index
// write must never break a note save or list.
export function reindexNote(userId, n) { try { _reindex(userId, n) } catch { /* best-effort */ } }
export function removeNote(userId, path) { try { _remove(userId, path) } catch { /* best-effort */ } }
export function clearUser(userId) { try { _clear(userId) } catch { /* best-effort */ } }

// Drop index rows for notes that no longer exist (mirrors the tagCache prune).
export function pruneMissing(userId, seen) {
  try { for (const r of stmts().paths.all(userId)) if (!seen.has(r.path)) removeNote(userId, r.path) } catch { /* best-effort */ }
}

// Ranked full-text search over a user's note bodies + titles.
export function search(userId, q, limit = 30) {
  const match = buildFtsQuery(q)
  if (!match) return []
  try {
    return stmts().search.all(match, userId, Math.min(50, Math.max(1, limit | 0)))
      .map((r) => ({ path: r.path, title: r.title, folder: r.folder, snippet: segmentSnippet(r.snip) }))
  } catch { return [] }
}

// Notes that [[link]] to `target` (a note title). Resolution is by current title,
// so a renamed note's stale inbound links simply stop resolving (Obsidian default).
export function backlinks(userId, target) {
  const t = String(target || '').trim().toLowerCase()
  if (!t) return []
  try { return stmts().backlinks.all(userId, t).map((r) => ({ path: r.src_path, raw: r.raw, context: r.context })) } catch { return [] }
}
