// Minimal WebDAV client for Nextcloud Files, used to store notes + their
// resources as real files in the user's own cloud. It reuses the CalDAV
// account's credentials (Basic auth, app password) and the SSRF egress guard,
// so no new auth/encryption is introduced. Nextcloud serves Files WebDAV at
// `<server>/remote.php/dav/files/<user>/…` (the account's server_url already
// ends in `/remote.php/dav`).
//
// Collection URLs ALWAYS carry a trailing slash and file URLs never do, which
// avoids Nextcloud's 301 collection redirects — important because safeFetch uses
// `redirect: 'error'` and never follows redirects.
import { XMLParser } from 'fast-xml-parser'
import { safeFetch, authHeader } from './caldav.js'

const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true })

export function filesBase(account) {
  const root = String(account.server_url || '').replace(/\/+$/, '')
  return `${root}/files/${encodeURIComponent(account.username)}/`
}

// Encode a path (relative to the files base) onto the base URL.
export function davUrl(account, path, isDir = false) {
  const segs = String(path || '').split('/').filter(Boolean).map(encodeURIComponent)
  let u = filesBase(account) + segs.join('/')
  if (isDir && !u.endsWith('/')) u += '/'
  return u
}

const hdr = (account, extra = {}) => ({ Authorization: authHeader(account), ...extra })
function httpErr(op, status) { const e = new Error(`webdav ${op} failed (${status})`); e.status = status >= 500 ? 502 : status; return e }
const cleanEtag = (e) => (e ? String(e).replace(/^W\//, '').replace(/"/g, '') : null)

// PROPFIND a collection (Depth 1 default) → [{ path, name, isDir, etag, mtime, size, contentType }].
// `path` is relative to the files base (e.g. "Notes/My note.md"). Returns null on 404.
export async function propfind(account, path, depth = 1) {
  const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">'
    + '<d:prop><d:resourcetype/><d:getetag/><d:getlastmodified/><d:getcontentlength/><d:getcontenttype/></d:prop></d:propfind>'
  const r = await safeFetch(davUrl(account, path, true), { method: 'PROPFIND', headers: hdr(account, { Depth: String(depth), 'Content-Type': 'application/xml' }), body })
  if (r.status === 404) return null
  if (!r.ok && r.status !== 207) throw httpErr('propfind', r.status)
  return parsePropfind(await r.text(), account)
}

export function parsePropfind(text, account) {
  const doc = xml.parse(text) || {}
  const ms = doc.multistatus || {}
  let resp = ms.response || []
  if (!Array.isArray(resp)) resp = [resp]
  const basePath = decodeURIComponent(new URL(filesBase(account)).pathname) // /remote.php/dav/files/<user>/
  const out = []
  for (const r of resp) {
    const href = decodeURIComponent(String(r.href || ''))
    if (!href.trim()) continue // RFC 4918 requires <href>; skip malformed entries
    let ps = r.propstat || []
    if (!Array.isArray(ps)) ps = [ps]
    const ok = ps.find((p) => /\b200\b/.test(String(p.status || ''))) || ps[0] || {}
    const prop = ok.prop || {}
    const isDir = !!(prop.resourcetype && typeof prop.resourcetype === 'object' && 'collection' in prop.resourcetype)
    let rel = href.startsWith(basePath) ? href.slice(basePath.length) : href
    rel = rel.replace(/\/+$/, '').replace(/^\/+/, '')
    out.push({
      path: rel,
      name: rel.split('/').pop(),
      isDir,
      etag: cleanEtag(prop.getetag),
      mtime: prop.getlastmodified ? new Date(prop.getlastmodified).toISOString() : null,
      size: prop.getcontentlength != null && prop.getcontentlength !== '' ? Number(prop.getcontentlength) : null,
      contentType: prop.getcontenttype || null,
    })
  }
  return out
}

// GET a file → { buffer, etag, contentType } or null on 404.
export async function read(account, path) {
  const r = await safeFetch(davUrl(account, path), { headers: hdr(account) })
  if (r.status === 404) return null
  if (!r.ok) throw httpErr('read', r.status)
  return { buffer: Buffer.from(await r.arrayBuffer()), etag: cleanEtag(r.headers.get('etag')), contentType: r.headers.get('content-type') }
}
export async function readText(account, path) { const f = await read(account, path); return f ? f.buffer.toString('utf8') : null }

// PUT a file. body = string | Buffer | Uint8Array. Returns the new etag.
export async function write(account, path, body, { contentType = 'application/octet-stream', ifMatch, ifNoneMatch } = {}) {
  const h = hdr(account, { 'Content-Type': contentType })
  if (ifMatch) h['If-Match'] = ifMatch
  if (ifNoneMatch) h['If-None-Match'] = ifNoneMatch
  const r = await safeFetch(davUrl(account, path), { method: 'PUT', headers: h, body })
  if (!r.ok && r.status !== 201 && r.status !== 204) throw httpErr('write', r.status)
  return { etag: cleanEtag(r.headers.get('etag')) }
}

export async function del(account, path, { ifMatch } = {}) {
  const h = hdr(account)
  if (ifMatch) h['If-Match'] = ifMatch
  const r = await safeFetch(davUrl(account, path), { method: 'DELETE', headers: h })
  if (!r.ok && r.status !== 204 && r.status !== 404) throw httpErr('delete', r.status)
}

// MKCOL (idempotent: 405 = already exists).
export async function mkcol(account, path) {
  const r = await safeFetch(davUrl(account, path, true), { method: 'MKCOL', headers: hdr(account) })
  if (r.ok || r.status === 201 || r.status === 405) return
  throw httpErr('mkcol', r.status)
}
// Create every missing ancestor collection of `path`.
export async function ensureCollection(account, path) {
  const segs = String(path || '').split('/').filter(Boolean)
  let cur = ''
  for (const s of segs) { cur += (cur ? '/' : '') + s; await mkcol(account, cur) }
}

export async function move(account, from, to, { overwrite = false } = {}) {
  const r = await safeFetch(davUrl(account, from), { method: 'MOVE', headers: hdr(account, { Destination: davUrl(account, to), Overwrite: overwrite ? 'T' : 'F' }) })
  if (!r.ok && r.status !== 201 && r.status !== 204) throw httpErr('move', r.status)
}

export async function exists(account, path) {
  const r = await safeFetch(davUrl(account, path), { method: 'PROPFIND', headers: hdr(account, { Depth: '0' }) })
  return r.ok || r.status === 207
}
