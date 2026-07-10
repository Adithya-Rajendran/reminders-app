// Notes store: one Markdown file per note inside a Nextcloud folder (over
// WebDAV), with images + drawings in a `_resources/` subfolder. The folder is
// fully self-contained — a fresh install pointed at it reconstructs every note
// by scanning the files. Per-note metadata (stable id, created/updated) lives in
// minimal YAML front-matter; the filename is the note title.
import crypto from 'node:crypto'
import yaml from 'js-yaml'
import { getAccount, listAccounts, getNotesConfig, setNotesConfig } from './config.js'
import * as dav from './webdav.js'
import * as idx from './noteindex.js'
import { err } from './util.js'

export const RES = '_resources'
export const TRASH = '.trash'
// Folders hidden from the notes tree/list: the resources store and the trash.
const isHidden = (name) => name === RES || name === TRASH
const MD = 'text/markdown; charset=utf-8'
const DEFAULT_ROOT = 'Notes'
const VALID_RES_NAME_RE = /^[\w.-]{1,160}$/ // safe resource filename (no slashes / traversal)
const MAX_TAGS = 30
const cleanTags = (t) => [...new Set((Array.isArray(t) ? t : []).map((x) => String(x).trim().replace(/[#,]/g, '')).filter(Boolean))].slice(0, MAX_TAGS)

// Short per-user cache for the (PROPFIND + read-per-note) listing, invalidated
// on any write — same pattern as the CalDAV task store.
const LIST_TTL = 15000
const listCache = new Map() // userId -> { at, notes }
const invalidate = (userId) => listCache.delete(userId)
// Per-(path,etag) front-matter cache (tags + created + pinned): re-listing only
// re-reads notes whose content actually changed (PROPFIND already returns each
// note's etag). NOT cleared on writes — a changed note gets a new etag and is
// re-read; the rest are reused, turning the per-note read fan-out into ~0 reads.
const tagCache = new Map() // userId -> Map<path, { etag, tags, created, pinned }>

const trimSlashes = (s) => String(s || '').replace(/^\/+|\/+$/g, '')
const join = (...p) => p.map(trimSlashes).filter(Boolean).join('/')

// Resolve { account, root } for a user. Defaults to the first CalDAV account +
// a `Notes` folder when nothing is configured, so notes work out of the box.
async function ctx(userId) {
  let cfg = await getNotesConfig(userId)
  if (!cfg || !cfg.accountId) {
    const accts = await listAccounts(userId)
    if (!accts.length) return null
    cfg = { accountId: accts[0].id, rootPath: (cfg && cfg.rootPath) || DEFAULT_ROOT }
  }
  const account = await getAccount(userId, cfg.accountId)
  if (!account) return null
  return { account, root: trimSlashes(cfg.rootPath) || DEFAULT_ROOT }
}

// Guard every path stays inside the configured notes root (no traversal).
export function inRoot(root, path) {
  const p = trimSlashes(path)
  if (p.split('/').includes('..')) return false
  return p === root || p.startsWith(root + '/')
}
const sanitizeName = (s) => String(s || '').replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
// Drops empty + traversal ('.', '..') segments so a crafted folder/path can
// never escape the user's Files root (defense in depth around inRoot).
export const sanitizeFolder = (s) => String(s || '').split('/').map(sanitizeName).filter((x) => x && x !== '.' && x !== '..').join('/')

// ---- front-matter ----
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
export function parseNote(text) {
  const m = FM_RE.exec(text || '')
  if (!m) return { meta: {}, body: text || '' }
  let meta = {}
  try { meta = yaml.load(m[1]) || {} } catch { meta = {} }
  if (typeof meta !== 'object' || Array.isArray(meta)) meta = {}
  return { meta, body: text.slice(m[0].length) }
}
export function serializeNote(meta, body) {
  const fm = yaml.dump(meta, { lineWidth: -1 }).trimEnd()
  return `---\n${fm}\n---\n${body || ''}`
}
const titleOf = (path) => path.split('/').pop().replace(/\.md$/i, '')

// ---- config / folders ----
export async function getConfig(userId) {
  const cfg = await getNotesConfig(userId)
  const accounts = (await listAccounts(userId)).map((a) => ({ id: a.id, name: a.name, type: a.type }))
  const c = await ctx(userId)
  return { accountId: cfg?.accountId || (c && c.account.id) || null, rootPath: cfg?.rootPath || DEFAULT_ROOT, accounts, configured: !!c }
}
export async function setConfig(userId, accountId, rootPath) {
  const accts = await listAccounts(userId)
  const acc = accts.find((a) => a.id === accountId) || accts[0]
  if (!acc) throw err('connect a CalDAV account first', 409)
  const root = sanitizeFolder(rootPath) || DEFAULT_ROOT
  // Validate BEFORE persisting: if the folder can't be created/reached (rights,
  // dead server), a failed attempt must leave the previous config intact —
  // persisting first left /api/notes wired to a folder it could never read.
  await dav.ensureCollection(acc, root)
  await setNotesConfig(userId, acc.id, root)
  idx.clearUser(userId) // the search index is per-WebDAV — drop it so it regenerates lazily after a reconnect/retarget
  return { accountId: acc.id, rootPath: root }
}

// Browse folders under the chosen account (for the root-folder picker).
export async function browse(userId, path = '') {
  const c = await ctx(userId)
  if (!c) return null
  const safe = sanitizeFolder(path)
  const entries = await dav.propfind(c.account, safe, 1)
  if (!entries) return { path: safe, folders: [] }
  const folders = entries
    .filter((e) => e.isDir && trimSlashes(e.path) !== trimSlashes(safe))
    .map((e) => ({ name: e.name, path: trimSlashes(e.path) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { path: safe, folders }
}

// Subfolders inside the notes root (for the move/notebook picker).
export async function listFolders(userId) {
  const c = await ctx(userId)
  if (!c) return null
  const out = ['']
  const walk = async (dir, prefix) => {
    const entries = await dav.propfind(c.account, dir, 1)
    for (const e of entries || []) {
      if (trimSlashes(e.path) === trimSlashes(dir)) continue
      if (e.isDir && !isHidden(e.name)) { const rel = prefix ? prefix + '/' + e.name : e.name; out.push(rel); await walk(e.path, rel) }
    }
  }
  await walk(c.root, '')
  return out
}
export async function createFolder(userId, folder) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  const rel = sanitizeFolder(folder)
  if (!rel) throw err('folder name required', 400)
  if (rel.split('/').includes(TRASH)) throw err('bad path', 400)
  const target = join(c.root, rel)
  if (!inRoot(c.root, target)) throw err('bad path', 400)
  await dav.ensureCollection(c.account, target)
  return { folder: rel }
}

// ---- notes ----
// Walk the tree (PROPFIND) then read each note's front-matter for its tags, so
// the widget can group by folder + filter by tag. Cached briefly per user.
export async function listNotes(userId) {
  const c = await ctx(userId)
  if (!c) return null
  const cached = listCache.get(userId)
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.notes
  const files = [] // a missing root just yields an empty list (created on first write)
  let folderCount = 0
  let truncated = false // the walk hit a depth/breadth bound → this listing is partial
  const walk = async (dir, depth) => {
    if (depth > 8 || folderCount > 400) { truncated = true; return } // bound a pathological tree
    const entries = await dav.propfind(c.account, dir, 1)
    const subdirs = []
    for (const e of entries || []) {
      if (trimSlashes(e.path) === trimSlashes(dir)) continue
      if (isHidden(e.name)) continue
      if (e.isDir) subdirs.push(e.path)
      else if (/\.md$/i.test(e.name)) files.push(e)
    }
    folderCount += subdirs.length
    await Promise.all(subdirs.slice(0, 400).map((d) => walk(d, depth + 1))) // siblings in parallel
  }
  await walk(c.root, 0)
  let tc = tagCache.get(userId); if (!tc) { tc = new Map(); tagCache.set(userId, tc) }
  const seen = new Set()
  const notes = await Promise.all(files.map(async (f) => {
    const fp = trimSlashes(f.path)
    seen.add(fp)
    const rel = fp.slice(c.root.length + 1)
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    let m = { tags: [], created: null, pinned: false }
    const hit = tc.get(fp)
    if (hit && f.etag && hit.etag === f.etag) m = hit // unchanged → reuse, skip the read
    else {
      // changed/new → read once; reuse that same body to refresh the search index
      // (so steady-state indexing adds zero extra reads, like the meta cache).
      try {
        const parsed = parseNote(await dav.readText(c.account, fp))
        m = { tags: cleanTags(parsed.meta.tags), created: parsed.meta.created || null, pinned: parsed.meta.pinned === true }
        idx.reindexNote(userId, { path: fp, title: titleOf(f.path), folder, body: parsed.body })
      } catch { /* skip a failing read */ }
      if (f.etag) tc.set(fp, { etag: f.etag, ...m })
    }
    return { path: fp, title: titleOf(f.path), folder, tags: m.tags, created: m.created, pinned: m.pinned, updated: f.mtime, etag: f.etag, size: f.size }
  }))
  // Only prune when the walk was COMPLETE — a partial listing (depth/breadth
  // bound hit) hasn't seen every note, so pruning would wrongly delete the cache
  // + search-index rows of notes it simply didn't reach.
  if (!truncated) {
    for (const k of tc.keys()) if (!seen.has(k)) tc.delete(k) // forget notes that no longer exist
    idx.pruneMissing(userId, seen) // drop search-index rows for notes that no longer exist (covers delete / move / rename)
  }
  notes.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
  listCache.set(userId, { at: Date.now(), notes })
  return notes
}

export async function getNote(userId, path) {
  const c = await ctx(userId)
  if (!c) return null
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const f = await dav.read(c.account, trimSlashes(path))
  if (!f) return null
  const { meta, body } = parseNote(f.buffer.toString('utf8'))
  const rel = trimSlashes(path).slice(c.root.length + 1)
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return { path: trimSlashes(path), title: titleOf(path), folder, meta, body, etag: f.etag }
}

export async function createNote(userId, { folder = '', title = 'Untitled' } = {}) {
  const c = await ctx(userId)
  if (!c) throw err('connect a CalDAV account first', 409)
  const dir = join(c.root, sanitizeFolder(folder))
  await dav.ensureCollection(c.account, dir)
  const base = sanitizeName(title) || 'Untitled'
  let name = base
  for (let n = 2; n < 500 && await dav.exists(c.account, join(dir, name + '.md')); n++) name = `${base} ${n}`
  const path = join(dir, name + '.md')
  const now = new Date().toISOString()
  const meta = { id: crypto.randomUUID(), created: now, updated: now }
  const w = await dav.write(c.account, path, serializeNote(meta, ''), { contentType: MD, ifNoneMatch: '*' })
  invalidate(userId)
  return { path, title: name, meta, body: '', etag: w.etag }
}

export async function saveNote(userId, path, { body = '', etag, tags } = {}) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const rel = trimSlashes(path)
  const existing = await dav.read(c.account, rel)
  let meta = { id: crypto.randomUUID(), created: new Date().toISOString() }
  if (existing) meta = { ...meta, ...parseNote(existing.buffer.toString('utf8')).meta }
  meta.updated = new Date().toISOString()
  if (tags !== undefined) { const t = cleanTags(tags); if (t.length) meta.tags = t; else delete meta.tags }
  try {
    const w = await dav.write(c.account, rel, serializeNote(meta, body), { contentType: MD, ifMatch: etag || existing?.etag || undefined })
    invalidate(userId)
    // refresh the search index with the body we just wrote — no extra read needed.
    const relToRoot = rel.slice(c.root.length + 1)
    idx.reindexNote(userId, { path: rel, title: titleOf(rel), folder: relToRoot.includes('/') ? relToRoot.slice(0, relToRoot.lastIndexOf('/')) : '', body })
    return { path: rel, meta, etag: w.etag }
  } catch (e) {
    if (e.status === 412) throw err('This note changed elsewhere — reload before saving.', 409)
    throw e
  }
}

export async function renameNote(userId, path, newTitle) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const rel = trimSlashes(path)
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : c.root
  const base = sanitizeName(newTitle) || 'Untitled'
  let target = join(dir, base + '.md')
  for (let n = 2; target !== rel && await dav.exists(c.account, target); n++) target = join(dir, `${base} ${n}.md`)
  if (target !== rel) await dav.move(c.account, rel, target)
  invalidate(userId)
  // Return the fresh etag via PROPFIND (MOVE gives the resource a new etag on
  // the server; the client must apply it so the next body-save's If-Match header
  // isn't stale — a stale If-Match causes a 412 → 409 on the next PUT).
  let etag = null
  try { const entries = await dav.propfind(c.account, target, 0); etag = entries?.[0]?.etag || null } catch { /* best-effort */ }
  return { path: target, title: titleOf(target), etag }
}

// Move a note into a different folder (creating it). Keeps the filename/id.
export async function moveNote(userId, path, folder) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const rel = trimSlashes(path)
  const name = rel.split('/').pop()
  if (sanitizeFolder(folder).split('/').includes(TRASH)) throw err('bad path', 400) // use the trash API, not move
  const dir = join(c.root, sanitizeFolder(folder))
  if (!inRoot(c.root, dir)) throw err('bad path', 400)
  await dav.ensureCollection(c.account, dir)
  let target = join(dir, name)
  for (let n = 2; target !== rel && await dav.exists(c.account, target); n++) target = join(dir, `${name.replace(/\.md$/i, '')} ${n}.md`)
  if (target !== rel) await dav.move(c.account, rel, target)
  invalidate(userId)
  // Return the fresh etag via PROPFIND — a MOVE gives the resource a new etag;
  // the client applies it so the next autosave's If-Match header stays current.
  let etag = null
  try { const entries = await dav.propfind(c.account, target, 0); etag = entries?.[0]?.etag || null } catch { /* best-effort */ }
  return { path: target, title: titleOf(target), folder: sanitizeFolder(folder), etag }
}

// Pin / unpin a note (frontmatter `pinned: true`). Preserves `updated` so a
// pin doesn't masquerade as an edit; merges only the one key (any other
// frontmatter an external app added is left intact).
export async function setPinned(userId, path, pinned) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const rel = trimSlashes(path)
  const existing = await dav.read(c.account, rel)
  if (!existing) throw err('not found', 404)
  const { meta, body } = parseNote(existing.buffer.toString('utf8'))
  if (pinned) meta.pinned = true; else delete meta.pinned
  const w = await dav.write(c.account, rel, serializeNote(meta, body), { contentType: MD, ifMatch: existing.etag })
  invalidate(userId)
  return { path: rel, pinned: !!pinned, etag: w.etag }
}

// Duplicate a note into the same folder ("<title> copy", fresh id + created).
export async function duplicateNote(userId, path) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  const src = await getNote(userId, path)
  if (!src) throw err('not found', 404)
  const created = await createNote(userId, { folder: src.folder, title: src.title + ' copy' })
  await saveNote(userId, created.path, { body: src.body, tags: src.meta?.tags })
  return { path: created.path, title: created.title, folder: src.folder }
}

export async function deleteNote(userId, path) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  await dav.del(c.account, trimSlashes(path))
  idx.removeNote(userId, trimSlashes(path))
  invalidate(userId)
  return { ok: true }
}

// ---- trash (soft delete) ----
// Move a note into <root>/.trash, recording where it came from so it can be
// restored. The trash folder is filtered out of the normal list/tree/folders.
export async function trashNote(userId, path) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const rel = trimSlashes(path)
  const existing = await dav.read(c.account, rel)
  if (!existing) throw err('not found', 404)
  const { meta, body } = parseNote(existing.buffer.toString('utf8'))
  const relToRoot = rel.slice(c.root.length + 1)
  meta.trashedFrom = relToRoot.includes('/') ? relToRoot.slice(0, relToRoot.lastIndexOf('/')) : ''
  meta.trashedAt = new Date().toISOString()
  delete meta.pinned
  await dav.write(c.account, rel, serializeNote(meta, body), { contentType: MD, ifMatch: existing.etag })
  const trashDir = join(c.root, TRASH)
  await dav.ensureCollection(c.account, trashDir)
  const name = rel.split('/').pop()
  let target = join(trashDir, name)
  for (let n = 2; await dav.exists(c.account, target); n++) target = join(trashDir, `${name.replace(/\.md$/i, '')} ${n}.md`)
  await dav.move(c.account, rel, target)
  idx.removeNote(userId, rel)
  invalidate(userId)
  return { ok: true }
}

export async function listTrash(userId) {
  const c = await ctx(userId)
  if (!c) return null
  const dir = join(c.root, TRASH)
  const entries = await dav.propfind(c.account, dir, 1)
  if (!entries) return []
  const out = []
  for (const e of entries) {
    if (trimSlashes(e.path) === trimSlashes(dir) || e.isDir || !/\.md$/i.test(e.name)) continue
    const fp = trimSlashes(e.path)
    let meta = {}
    try { meta = parseNote(await dav.readText(c.account, fp)).meta } catch { /* skip a failing read */ }
    out.push({ path: fp, title: titleOf(fp), trashedFrom: meta.trashedFrom || '', trashedAt: meta.trashedAt || null, updated: e.mtime, etag: e.etag })
  }
  out.sort((a, b) => String(b.trashedAt || '').localeCompare(String(a.trashedAt || '')))
  return out
}

export async function restoreNote(userId, path) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!inRoot(c.root, path)) throw err('bad path', 400)
  const rel = trimSlashes(path)
  if (!rel.startsWith(join(c.root, TRASH) + '/')) throw err('not a trashed note', 400) // only restore from .trash
  const existing = await dav.read(c.account, rel)
  if (!existing) throw err('not found', 404)
  const { meta, body } = parseNote(existing.buffer.toString('utf8'))
  const dest = sanitizeFolder(meta.trashedFrom || '')
  delete meta.trashedFrom
  delete meta.trashedAt
  await dav.write(c.account, rel, serializeNote(meta, body), { contentType: MD, ifMatch: existing.etag })
  const dir = join(c.root, dest)
  await dav.ensureCollection(c.account, dir)
  const name = rel.split('/').pop()
  let target = join(dir, name)
  for (let n = 2; await dav.exists(c.account, target); n++) target = join(dir, `${name.replace(/\.md$/i, '')} ${n}.md`)
  await dav.move(c.account, rel, target)
  invalidate(userId)
  return { path: target, title: titleOf(target), folder: dest }
}

export async function emptyTrash(userId) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  for (const t of (await listTrash(userId)) || []) { try { await dav.del(c.account, t.path) } catch { /* keep going */ } }
  invalidate(userId)
  return { ok: true }
}

// Move a folder (and everything inside it) into another folder. `from`/`to` are
// relative to the notes root; `to`='' is the root. Refuses to move a folder into
// itself or one of its own descendants. Returns the folder's new relative path.
export async function moveFolder(userId, from, to) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  const src = sanitizeFolder(from)
  if (!src) throw err('folder required', 400)
  const name = src.split('/').pop()
  const destParent = sanitizeFolder(to) // '' = root
  if (src.split('/').includes(TRASH) || destParent.split('/').includes(TRASH)) throw err('bad path', 400)
  if (destParent === src || destParent.startsWith(src + '/')) throw err('cannot move a folder into itself', 400)
  const srcParent = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : ''
  if (destParent === srcParent) return { folder: src } // already there
  const srcAbs = join(c.root, src)
  if (!inRoot(c.root, srcAbs)) throw err('bad path', 400)
  await dav.ensureCollection(c.account, join(c.root, destParent))
  let rel = destParent ? destParent + '/' + name : name
  let target = join(c.root, rel)
  for (let n = 2; await dav.exists(c.account, target); n++) { rel = (destParent ? destParent + '/' : '') + name + ' ' + n; target = join(c.root, rel) }
  if (!inRoot(c.root, target)) throw err('bad path', 400)
  await dav.move(c.account, srcAbs, target)
  invalidate(userId)
  return { folder: rel }
}

// ---- resources (images, drawings) ----
export async function putResource(userId, name, buffer, contentType) {
  const c = await ctx(userId)
  if (!c) throw err('notes not configured', 409)
  if (!VALID_RES_NAME_RE.test(name)) throw err('bad resource name', 400)
  const dir = join(c.root, RES)
  await dav.ensureCollection(c.account, dir)
  await dav.write(c.account, join(dir, name), buffer, { contentType: contentType || 'application/octet-stream' })
  return { name, ref: `${RES}/${name}` }
}
export async function getResource(userId, name) {
  const c = await ctx(userId)
  if (!c) return null
  if (!VALID_RES_NAME_RE.test(name)) return null
  return dav.read(c.account, join(c.root, RES, name))
}

// ---- search (full-text over note bodies, served from the local FTS index) ----
export function searchNotes(userId, q, limit) { return idx.search(userId, q, limit) }

// Notes that [[link]] to the given note (resolved by its current title). A rename
// changes the title, so old inbound links simply stop resolving (Obsidian default).
export function backlinksFor(userId, path) {
  const title = titleOf(trimSlashes(path))
  return idx.backlinks(userId, title)
    .filter((b) => b.path !== trimSlashes(path)) // a note never lists itself
    .map((b) => ({ path: b.path, title: titleOf(b.path), context: b.context || '' }))
}
