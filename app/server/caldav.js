// CalDAV integration: connect to a CalDAV server, discover VTODO task lists,
// read tasks, and toggle completion (editing the VTODO in place to preserve
// VALARMs / unknown properties — RFC 4791 §8.6). Uses tsdav + ical.js.
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { createDAVClient } from 'tsdav'
import ICAL from 'ical.js'
import {
  getAccount, listAccounts, insertAccount, deleteAccount, deleteAccountById,
  upsertList, pruneLists, listsForAccount, enabledListsForAccount, setListEnabled,
} from './config.js'

// ---- SSRF egress guard for outbound CalDAV requests ----
// CalDAV server/object URLs are user-supplied, so every outbound request must be
// vetted. Loopback, the unspecified address, link-local (incl. the cloud
// metadata IP 169.254.169.254) and multicast are NEVER a valid CalDAV target and
// are always blocked. RFC1918 / ULA are allowed by default because self-hosted
// CalDAV commonly lives on a LAN/cluster IP; set CALDAV_BLOCK_PRIVATE=1 to also
// block those on internet-facing deployments.
const BLOCK_PRIVATE = process.env.CALDAV_BLOCK_PRIVATE === '1'
function ipBlocked(ip) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  const v = m ? m[1] : ip
  if (net.isIPv4(v)) {
    const o = v.split('.').map(Number)
    if (o[0] === 0 || o[0] === 127 || (o[0] === 169 && o[1] === 254) || o[0] >= 224) return true
    const priv = o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
    return priv ? BLOCK_PRIVATE : false
  }
  const lo = ip.toLowerCase()
  if (lo === '::' || lo === '::1' || lo.startsWith('fe80') || lo.startsWith('ff')) return true
  if (lo.startsWith('fc') || lo.startsWith('fd')) return BLOCK_PRIVATE
  return false
}
async function assertEgressAllowed(urlStr) {
  let u
  try { u = new URL(urlStr) } catch { const e = new Error('invalid URL'); e.status = 400; throw e }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { const e = new Error('only http(s) URLs are allowed'); e.status = 400; throw e }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  let addrs
  if (net.isIP(host)) addrs = [{ address: host }]
  else { try { addrs = await dns.lookup(host, { all: true }) } catch { const e = new Error('host did not resolve'); e.status = 400; throw e } }
  for (const a of addrs) if (ipBlocked(a.address)) { const e = new Error('destination address not allowed'); e.status = 400; throw e }
}
// Guarded fetch: vet the destination, and never follow redirects (a redirect
// could bounce an allowed host to a blocked internal one / enable DNS rebinding).
export async function safeFetch(url, opts = {}) {
  await assertEgressAllowed(url)
  return fetch(url, { ...opts, redirect: 'error' })
}

// tsdav's fetchCalendarObjects defaults to a VEVENT filter, which excludes
// tasks — we must explicitly query for VTODO components.
export const VTODO_FILTER = [{ 'comp-filter': { _attributes: { name: 'VCALENDAR' }, 'comp-filter': { _attributes: { name: 'VTODO' } } } }]

// ---- password encryption at rest (AES-256-GCM) ----
const KEY = crypto.createHash('sha256')
  .update(process.env.CALDAV_ENC_KEY || process.env.SESSION_SECRET || 'dev-insecure')
  .digest()
function enc(plain) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}
function dec(b64) {
  const buf = Buffer.from(b64, 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

// CalDAV account/list persistence lives in config.js (the only DB this app uses).

function normalizeServerUrl(type, serverUrl) {
  if (type === 'icloud') return 'https://caldav.icloud.com'
  const u = (serverUrl || '').trim().replace(/\/+$/, '')
  if (type === 'nextcloud' && !/\/remote\.php\/dav$/.test(u)) return u + '/remote.php/dav'
  return u
}

export async function clientFor(acc) {
  await assertEgressAllowed(acc.server_url)
  return createDAVClient({
    serverUrl: acc.server_url,
    credentials: { username: acc.username, password: dec(acc.password_enc) },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })
}

export function authHeader(acc) {
  return 'Basic ' + Buffer.from(acc.username + ':' + dec(acc.password_enc)).toString('base64')
}

// Nextcloud's "Contact birthdays" (and the older "birthdays") calendar is a
// system-generated, read-only collection — a VTODO PUT there fails with 403, so
// it must never be offered as a task list.
const isReadOnlySystemCalendar = (url) => /\/(contact_birthdays|birthdays)\/?(?:$|\?)/i.test(url || '')

// Can the current user WRITE to this collection? We only DECIDE read-only when the
// server actually returns a current-user-privilege-set with privilege entries and
// none of them grant write — otherwise we assume writable, so we never wrongly
// hide a real list on a server (like this Nextcloud) that doesn't report it.
async function calendarWritable(acc, url) {
  try {
    const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-privilege-set/></d:prop></d:propfind>'
    const r = await safeFetch(url, { method: 'PROPFIND', headers: { Authorization: authHeader(acc), Depth: '0', 'Content-Type': 'application/xml' }, body })
    if (!r.ok) return true
    const t = await r.text()
    if (!/<[a-z0-9]*:?privilege>/i.test(t)) return true // no privilege list reported → assume writable
    return /<[a-z0-9]*:?(write|write-content|bind)\s*\/?>/i.test(t)
  } catch { return true }
}

// The calendar-home collection (parent of all calendars), derived from any
// discovered calendar URL.
function calendarHome(calendars) {
  const u = calendars.map((c) => c.url).find(Boolean)
  return u ? u.replace(/\/[^/]+\/?$/, '/') : null
}

// Create a dedicated VTODO "Tasks" calendar via MKCALENDAR. Used when an account
// has no writable task list of its own (e.g. only event-only calendars), so the
// task app has somewhere to put tasks. Idempotent (405 = already exists).
async function createTaskCalendar(acc, home) {
  const url = home + 'reminders-tasks/'
  const body = '<?xml version="1.0" encoding="utf-8"?>'
    + '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>'
    + '<D:displayname>Tasks</D:displayname>'
    + '<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>'
    + '</D:prop></D:set></C:mkcalendar>'
  try {
    const r = await safeFetch(url, { method: 'MKCALENDAR', headers: { Authorization: authHeader(acc), 'Content-Type': 'application/xml; charset=utf-8' }, body })
    if (r.ok || r.status === 201 || r.status === 405) return url
    console.error('MKCALENDAR failed (' + r.status + ')')
    return null
  } catch (e) { console.error('MKCALENDAR error:', e?.message || e); return null }
}

// ---- discovery: list VTODO-capable calendars and persist them ----
async function discover(acc) {
  const client = await clientFor(acc)
  const calendars = await client.fetchCalendars()
  const vtodo = calendars.filter((c) => {
    const comps = (c.components || []).map((x) => String(x).toUpperCase())
    // Keep task (VTODO) AND event (VEVENT) calendars, so the calendar widget can use them.
    return comps.length === 0 || comps.includes('VTODO') || comps.includes('VEVENT')
  })
  let anyVtodo = false
  for (const c of vtodo) {
    const name = typeof c.displayName === 'string' ? c.displayName : (c.displayName?.['_'] || c.url)
    const comps = (c.components || []).map((x) => String(x).toUpperCase())
    const vtodoCapable = comps.length === 0 || comps.includes('VTODO')
    // A task list must be VTODO-capable AND writable (not a read-only system
    // calendar). Read-only calendars stay discoverable (the calendar widget can
    // still show their events) but are not offered as task projects.
    const supportsVtodo = vtodoCapable && !isReadOnlySystemCalendar(c.url) && await calendarWritable(acc, c.url)
    if (supportsVtodo) anyVtodo = true
    const color = String(c.calendarColor || c.color || '')
    await upsertList(acc.id, { url: c.url, displayName: name, color, supportsVtodo })
  }
  await pruneLists(acc.id, vtodo.map((c) => c.url)) // drop lists that no longer exist
  // No writable task list? Create a "Tasks" (VTODO) calendar so the app works.
  if (!anyVtodo) {
    const home = calendarHome(calendars)
    if (home) {
      const url = await createTaskCalendar(acc, home)
      if (url) await upsertList(acc.id, { url, displayName: 'Tasks', color: '', supportsVtodo: true })
    }
  }
  return listsForAccount(acc.id)
}

function acctPublic(a, lists) {
  return { id: a.id, name: a.name, type: a.type, serverUrl: a.server_url, username: a.username, lists: lists || [] }
}

// ---- parse a VTODO ics object into a normalized task ----
function parseVtodos(icsData, ctx) {
  const out = []
  let comp
  try { comp = new ICAL.Component(ICAL.parse(icsData)) } catch { return out }
  for (const vt of comp.getAllSubcomponents('vtodo')) {
    const status = (vt.getFirstPropertyValue('status') || 'NEEDS-ACTION') + ''
    const dueVal = vt.getFirstPropertyValue('due')
    out.push({
      ...ctx,
      uid: vt.getFirstPropertyValue('uid') + '',
      summary: (vt.getFirstPropertyValue('summary') || '(untitled)') + '',
      due: dueVal ? dueVal.toJSDate().toISOString() : null,
      status,
      done: status.toUpperCase() === 'COMPLETED',
      priority: vt.getFirstPropertyValue('priority') || 0,
    })
  }
  return out
}

// ---- public handlers (Express) ----
export async function listAccountsHandler(req, res, next) {
  try {
    const accounts = []
    for (const a of await listAccounts(req.session.user.sub)) accounts.push(acctPublic(a, await listsForAccount(a.id)))
    res.json({ accounts })
  } catch (e) { next(e) }
}

export async function addAccountHandler(req, res) {
  const { name, type, serverUrl, username, password } = req.body || {}
  if (!name || !type || !username || !password || (type !== 'icloud' && !serverUrl)) {
    return res.status(400).json({ error: 'name, type, username, password (and serverUrl) are required' })
  }
  const acc = {
    id: 'ca-' + crypto.randomUUID(), user_id: req.session.user.sub, name, type,
    server_url: normalizeServerUrl(type, serverUrl), username, password_enc: enc(password),
  }
  try {
    // persist, then validate credentials by discovering its calendars
    await insertAccount(acc)
    const lists = await discover(acc)
    res.json({ account: acctPublic(acc, lists) })
  } catch (e) {
    await deleteAccountById(acc.id).catch(() => {})
    console.error('caldav add/discover failed:', e?.message || e)
    res.status(400).json({ error: 'Could not connect — check the server URL, username and (app) password.' })
  }
}

export async function discoverHandler(req, res) {
  try {
    const acc = await getAccount(req.session.user.sub, req.params.id)
    if (!acc) return res.status(404).json({ error: 'not found' })
    res.json({ lists: await discover(acc) })
  } catch (e) {
    console.error('caldav discover failed:', e?.message || e)
    res.status(400).json({ error: 'Discovery failed — check the connection.' })
  }
}

export async function setListsHandler(req, res, next) {
  try {
    const acc = await getAccount(req.session.user.sub, req.params.id)
    if (!acc) return res.status(404).json({ error: 'not found' })
    const enabled = new Set(Array.isArray(req.body?.enabled) ? req.body.enabled : [])
    for (const l of await listsForAccount(acc.id)) await setListEnabled(acc.id, l.url, enabled.has(l.url))
    res.json({ ok: true, lists: await listsForAccount(acc.id) })
  } catch (e) { next(e) }
}

export async function deleteAccountHandler(req, res, next) {
  try {
    await deleteAccount(req.session.user.sub, req.params.id)
    res.json({ ok: true })
  } catch (e) { next(e) }
}

export async function fetchTasksHandler(req, res) {
  try {
    const accs = await listAccounts(req.session.user.sub)
    const tasks = []
    for (const acc of accs) {
      const lists = await enabledListsForAccount(acc.id)
      if (!lists.length) continue
      let client
      try { client = await clientFor(acc) } catch { continue }
      for (const list of lists) {
        try {
          const objs = await client.fetchCalendarObjects({ calendar: { url: list.url }, filters: VTODO_FILTER })
          for (const o of objs) {
            tasks.push(...parseVtodos(o.data, {
              accountId: acc.id, accountName: acc.name, listUrl: list.url,
              listName: list.display_name, objectUrl: o.url, etag: o.etag,
            }))
          }
        } catch (e) { /* skip a failing list */ }
      }
    }
    tasks.sort((a, b) => (a.done - b.done) || ((a.due || '9999') > (b.due || '9999') ? 1 : -1))
    res.json({ tasks })
  } catch (e) {
    console.error('caldav fetchTasks failed:', e?.message || e)
    res.status(502).json({ error: 'could not fetch CalDAV tasks' })
  }
}

export async function toggleHandler(req, res) {
  const { accountId, objectUrl, done } = req.body || {}
  try {
    const acc = await getAccount(req.session.user.sub, accountId)
    if (!acc || !objectUrl) return res.status(400).json({ error: 'bad request' })
    const r = await safeFetch(objectUrl, { headers: { Authorization: authHeader(acc) } })
    if (!r.ok) return res.status(502).json({ error: 'fetch failed' })
    const etag = r.headers.get('etag')
    const comp = new ICAL.Component(ICAL.parse(await r.text()))
    const vt = comp.getFirstSubcomponent('vtodo')
    if (!vt) return res.status(404).json({ error: 'no vtodo' })
    if (done) {
      vt.updatePropertyWithValue('status', 'COMPLETED')
      vt.updatePropertyWithValue('percent-complete', 100)
      vt.updatePropertyWithValue('completed', ICAL.Time.now())
    } else {
      vt.updatePropertyWithValue('status', 'NEEDS-ACTION')
      vt.updatePropertyWithValue('percent-complete', 0)
      vt.removeAllProperties('completed')
    }
    const headers = { Authorization: authHeader(acc), 'Content-Type': 'text/calendar; charset=utf-8' }
    if (etag) headers['If-Match'] = etag
    const put = await safeFetch(objectUrl, { method: 'PUT', headers, body: comp.toString() })
    if (!put.ok && put.status !== 204) return res.status(502).json({ error: 'update failed (' + put.status + ')' })
    res.json({ ok: true })
  } catch (e) {
    console.error('caldav toggle failed:', e?.message || e)
    res.status(502).json({ error: 'toggle failed' })
  }
}

// ============================================================
//  Calendar events (VEVENT) CRUD — RFC 4791 / RFC 5545
// ============================================================

function icalUTC(iso) {
  return ICAL.Time.fromJSDate(new Date(iso), true).toICALString()
}

// tsdav serializes this object straight to a CalDAV calendar-query <filter>,
// with a <time-range> so the server only returns VEVENTs overlapping the window.
function veventFilter(startISO, endISO) {
  return [{
    'comp-filter': {
      _attributes: { name: 'VCALENDAR' },
      'comp-filter': {
        _attributes: { name: 'VEVENT' },
        'time-range': { _attributes: { start: icalUTC(startISO), end: icalUTC(endISO) } },
      },
    },
  }]
}

// All-day -> VALUE=DATE (no zone); timed -> UTC date-time (trailing Z).
function timeFromISO(iso, allDay) {
  const d = new Date(iso)
  if (allDay) return new ICAL.Time({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), isDate: true })
  return ICAL.Time.fromJSDate(d, true)
}

function setTimeProp(ve, name, time) {
  ve.removeAllProperties(name)
  const prop = new ICAL.Property(name)
  prop.resetType(time.isDate ? 'date' : 'date-time')
  prop.setValue(time)
  ve.addProperty(prop)
}

function recastTime(t, allDay) {
  if (allDay === !!t.isDate) return t
  if (allDay) return new ICAL.Time({ year: t.year, month: t.month, day: t.day, isDate: true })
  return ICAL.Time.fromJSDate(t.toJSDate(), true)
}

// All-day -> 'YYYY-MM-DD' (FullCalendar-friendly, no TZ drift); timed -> UTC ISO.
function veventISO(t) {
  if (t.isDate) {
    const p = (n) => String(n).padStart(2, '0')
    return `${t.year}-${p(t.month)}-${p(t.day)}`
  }
  return t.toJSDate().toISOString()
}

function parseVevents(icsData, ctx) {
  const out = []
  let comp
  try { comp = new ICAL.Component(ICAL.parse(icsData)) } catch { return out }
  for (const ve of comp.getAllSubcomponents('vevent')) {
    const dtstart = ve.getFirstPropertyValue('dtstart')
    if (!dtstart) continue
    const dtend = ve.getFirstPropertyValue('dtend')
    out.push({
      ...ctx,
      id: 'evt-' + (ve.getFirstPropertyValue('uid') + ''),
      title: (ve.getFirstPropertyValue('summary') || '(untitled)') + '',
      start: veventISO(dtstart),
      end: dtend ? veventISO(dtend) : null,
      allDay: !!dtstart.isDate,
    })
  }
  return out
}

async function fetchEvents(userId, startISO, endISO) {
  const accs = await listAccounts(userId)
  const events = []
  for (const acc of accs) {
    const lists = await enabledListsForAccount(acc.id)
    if (!lists.length) continue
    let client
    try { client = await clientFor(acc) } catch { continue }
    for (const list of lists) {
      try {
        const objs = await client.fetchCalendarObjects({ calendar: { url: list.url }, filters: veventFilter(startISO, endISO) })
        for (const o of objs) {
          events.push(...parseVevents(o.data, { accountId: acc.id, listUrl: list.url, objectUrl: o.url, etag: o.etag }))
        }
      } catch (e) { /* skip a failing / event-incapable list */ }
    }
  }
  return events
}

async function createEvent(acc, { listUrl, summary, start, end, allDay }) {
  const uid = crypto.randomUUID()
  const vcal = new ICAL.Component('vcalendar')
  vcal.updatePropertyWithValue('prodid', '-//reminders-app//caldav//EN')
  vcal.updatePropertyWithValue('version', '2.0')
  const ve = new ICAL.Component('vevent')
  ve.updatePropertyWithValue('uid', uid)
  ve.updatePropertyWithValue('dtstamp', ICAL.Time.now())
  ve.updatePropertyWithValue('summary', (summary || '(untitled)') + '')
  ve.updatePropertyWithValue('sequence', 0)
  setTimeProp(ve, 'dtstart', timeFromISO(start, allDay))
  if (allDay) {
    // All-day VEVENTs need an EXCLUSIVE DTEND (>= start + 1 day); otherwise a
    // zero-length all-day event is dropped from day/week/list views.
    const sd = new Date(start)
    let ed = (end !== undefined && end !== null && end !== '') ? new Date(end) : null
    if (!ed || isNaN(ed.getTime()) || ed.getTime() <= sd.getTime()) { ed = new Date(sd); ed.setUTCDate(ed.getUTCDate() + 1) }
    setTimeProp(ve, 'dtend', timeFromISO(ed.toISOString(), true))
  } else if (end !== undefined && end !== null && end !== '') {
    setTimeProp(ve, 'dtend', timeFromISO(end, false))
  }
  vcal.addSubcomponent(ve)

  const objectUrl = (listUrl.endsWith('/') ? listUrl : listUrl + '/') + uid + '.ics'
  const headers = { Authorization: authHeader(acc), 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }
  const put = await safeFetch(objectUrl, { method: 'PUT', headers, body: vcal.toString() })
  if (!put.ok && put.status !== 201 && put.status !== 204) throw new Error('create failed (' + put.status + ')')
  return parseVevents(vcal.toString(), { accountId: acc.id, listUrl, objectUrl, etag: put.headers.get('etag') })[0]
}

async function updateEvent(acc, { objectUrl, summary, start, end, allDay }) {
  const r = await safeFetch(objectUrl, { headers: { Authorization: authHeader(acc) } })
  if (!r.ok) throw new Error('fetch failed (' + r.status + ')')
  const etag = r.headers.get('etag')
  const comp = new ICAL.Component(ICAL.parse(await r.text()))
  const ve = comp.getFirstSubcomponent('vevent')
  if (!ve) throw new Error('no vevent')

  if (summary !== undefined) ve.updatePropertyWithValue('summary', (summary || '(untitled)') + '')

  const curStart = ve.getFirstPropertyValue('dtstart')
  const isAllDay = allDay === undefined ? !!(curStart && curStart.isDate) : !!allDay

  if (start !== undefined) {
    setTimeProp(ve, 'dtstart', timeFromISO(start, isAllDay))
  } else if (allDay !== undefined && curStart) {
    setTimeProp(ve, 'dtstart', recastTime(curStart, isAllDay))
  }

  if (end !== undefined) {
    if (end === null || end === '') ve.removeAllProperties('dtend')
    else setTimeProp(ve, 'dtend', timeFromISO(end, isAllDay))
  } else if (allDay !== undefined) {
    const curEnd = ve.getFirstPropertyValue('dtend')
    if (curEnd) setTimeProp(ve, 'dtend', recastTime(curEnd, isAllDay))
  }

  // An all-day event must keep an EXCLUSIVE DTEND strictly after DTSTART — e.g.
  // converting a same-day timed event to all-day would otherwise yield
  // DTEND==DTSTART (zero length) and vanish from day/week/list views.
  if (isAllDay) {
    const ds = ve.getFirstPropertyValue('dtstart')
    const de = ve.getFirstPropertyValue('dtend')
    if (ds && (!de || de.compare(ds) <= 0)) {
      const ne = ds.clone(); ne.adjust(1, 0, 0, 0)
      setTimeProp(ve, 'dtend', ne)
    }
  }

  ve.updatePropertyWithValue('sequence', Number(ve.getFirstPropertyValue('sequence') || 0) + 1)
  ve.updatePropertyWithValue('last-modified', ICAL.Time.now())
  ve.updatePropertyWithValue('dtstamp', ICAL.Time.now())

  const headers = { Authorization: authHeader(acc), 'Content-Type': 'text/calendar; charset=utf-8' }
  if (etag) headers['If-Match'] = etag
  const put = await safeFetch(objectUrl, { method: 'PUT', headers, body: comp.toString() })
  if (!put.ok && put.status !== 204) throw new Error('update failed (' + put.status + ')')
}

async function deleteEvent(acc, { objectUrl }) {
  let etag
  try {
    const r = await safeFetch(objectUrl, { headers: { Authorization: authHeader(acc) } })
    if (r.ok) etag = r.headers.get('etag')
  } catch { /* fall through to an unconditional delete */ }
  const headers = { Authorization: authHeader(acc) }
  if (etag) headers['If-Match'] = etag
  const del = await safeFetch(objectUrl, { method: 'DELETE', headers })
  if (!del.ok && del.status !== 204 && del.status !== 404) throw new Error('delete failed (' + del.status + ')')
}

export async function calendarEventsHandler(req, res) {
  const { start, end } = req.query || {}
  if (!start || !end) return res.status(400).json({ error: 'start and end are required' })
  try {
    res.json({ events: await fetchEvents(req.session.user.sub, start, end) })
  } catch (e) {
    console.error('caldav fetchEvents failed:', e?.message || e)
    res.status(502).json({ error: 'could not fetch calendar events' })
  }
}

export async function createEventHandler(req, res) {
  const { accountId, listUrl, summary, start, end, allDay } = req.body || {}
  if (!accountId || !listUrl || !start) return res.status(400).json({ error: 'accountId, listUrl and start are required' })
  if (isNaN(new Date(start).getTime())) return res.status(400).json({ error: 'invalid start date' })
  if (end != null && end !== '') {
    if (isNaN(new Date(end).getTime())) return res.status(400).json({ error: 'invalid end date' })
    if (!allDay && new Date(end).getTime() <= new Date(start).getTime()) return res.status(400).json({ error: 'end must be after start' })
  }
  try {
    const acc = await getAccount(req.session.user.sub, accountId)
    if (!acc) return res.status(404).json({ error: 'not found' })
    const event = await createEvent(acc, { listUrl, summary, start, end, allDay: !!allDay })
    res.json({ ok: true, event })
  } catch (e) {
    console.error('caldav createEvent failed:', e?.message || e)
    res.status(502).json({ error: 'could not create event' })
  }
}

export async function updateEventHandler(req, res) {
  const { accountId, objectUrl, summary, start, end, allDay } = req.body || {}
  if (!accountId || !objectUrl) return res.status(400).json({ error: 'accountId and objectUrl are required' })
  if (start != null && start !== '' && isNaN(new Date(start).getTime())) return res.status(400).json({ error: 'invalid start date' })
  if (end != null && end !== '' && isNaN(new Date(end).getTime())) return res.status(400).json({ error: 'invalid end date' })
  if (start && end && end !== '' && !allDay && new Date(end).getTime() <= new Date(start).getTime()) return res.status(400).json({ error: 'end must be after start' })
  try {
    const acc = await getAccount(req.session.user.sub, accountId)
    if (!acc) return res.status(404).json({ error: 'not found' })
    await updateEvent(acc, { objectUrl, summary, start, end, allDay })
    res.json({ ok: true })
  } catch (e) {
    console.error('caldav updateEvent failed:', e?.message || e)
    res.status(502).json({ error: 'could not update event' })
  }
}

export async function deleteEventHandler(req, res) {
  const { accountId, objectUrl } = req.body || {}
  if (!accountId || !objectUrl) return res.status(400).json({ error: 'accountId and objectUrl are required' })
  try {
    const acc = await getAccount(req.session.user.sub, accountId)
    if (!acc) return res.status(404).json({ error: 'not found' })
    await deleteEvent(acc, { objectUrl })
    res.json({ ok: true })
  } catch (e) {
    console.error('caldav deleteEvent failed:', e?.message || e)
    res.status(502).json({ error: 'could not delete event' })
  }
}
