// CalDAV-backed task store — same /api/{projects,tasks,labels} handlers + wire
// shape as tasks.js, but tasks live as VTODOs in the user's CalDAV server.
// projects = VTODO lists (caldav_lists.id); task.id = encodeTaskId(listId,objectUrl);
// labels = CATEGORIES. Selected at boot via taskstore.js (TASK_STORE=caldav).
import crypto from 'node:crypto'
import ICAL from 'ical.js'
import { clientFor, authHeader, safeFetch, VTODO_FILTER, listsWithId, getListById } from './caldav.js'
import { encodeTaskId, decodeTaskId, encodeLabelId, decodeLabelId } from './taskid.js'
import { advanceRecurringVtodo, applyRepeatFields, repeatFieldsFromVtodo, isRecurring, registerTimezones } from './recurrence_caldav.js'
import { applyReminders, readReminders } from './valarm.js'

const ZERO = '0001-01-01T00:00:00Z'
const outTs = (d) => (d && new Date(d).getUTCFullYear() > 1) ? new Date(d).toISOString() : ZERO
const OUR_TO_ICAL = { 0: 0, 1: 9, 2: 7, 3: 5, 4: 3, 5: 1 }
function icalToOur(p) { const n = Number(p) || 0; if (n <= 0) return 0; if (n <= 2) return 5; if (n <= 4) return 4; if (n <= 6) return 3; if (n <= 8) return 2; return 1 }
const clampPriority = (p) => { const n = Math.trunc(Number(p)); return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0 }
const accountOf = (row) => ({ id: row.account_id, type: row.account_type, server_url: row.account_server_url, username: row.account_username, password_enc: row.account_password_enc })

// ---- VTODO helpers ----
const pickMaster = (vcal) => { const v = vcal.getAllSubcomponents('vtodo'); return v.find((x) => !x.getFirstProperty('recurrence-id')) || v[0] || null }
function safeParse(ics) { try { const vcal = new ICAL.Component(ICAL.parse(ics)); return { vcal, vt: pickMaster(vcal) } } catch { return { vcal: null, vt: null } } }
function inDue(v) { if (v === null || v === undefined || v === '' || v === ZERO) return null; const d = new Date(v); return (isNaN(d) || d.getUTCFullYear() <= 1) ? null : ICAL.Time.fromJSDate(d, true) }
function setDue(vt, time) { vt.removeAllProperties('due'); if (time) { const p = new ICAL.Property('due'); p.resetType('date-time'); p.setValue(time); vt.addProperty(p) } }
function setCategories(vt, names) { vt.removeAllProperties('categories'); if (names.length) { const p = new ICAL.Property('categories'); p.setValues(names); vt.addProperty(p) } }
function readCategories(vt) {
  const set = new Set()
  for (const p of vt.getAllProperties('categories')) for (const v of (p.getValues() || [])) { const s = String(v).trim(); if (s) set.add(s) }
  return [...set].map((title) => ({ id: encodeLabelId(title), title, hex_color: '' }))
}
export function serializeVtodo(vt, listId, objectUrl) {
  const done = String(vt.getFirstPropertyValue('status') || 'NEEDS-ACTION').toUpperCase() === 'COMPLETED'
  const dueV = vt.getFirstPropertyValue('due') || vt.getFirstPropertyValue('dtstart')
  const compV = vt.getFirstPropertyValue('completed')
  const created = vt.getFirstPropertyValue('created')
  const updated = vt.getFirstPropertyValue('last-modified') || vt.getFirstPropertyValue('dtstamp')
  const rep = repeatFieldsFromVtodo(vt)
  return {
    id: encodeTaskId(listId, objectUrl), project_id: listId,
    title: String(vt.getFirstPropertyValue('summary') || '(untitled)'),
    description: String(vt.getFirstPropertyValue('description') || ''),
    done, done_at: done ? outTs(compV ? compV.toJSDate() : new Date()) : ZERO,
    due_date: dueV ? outTs(dueV.toJSDate()) : ZERO,
    priority: icalToOur(vt.getFirstPropertyValue('priority')),
    repeat_after: rep.repeat_after, repeat_mode: rep.repeat_mode,
    reminders: readReminders(vt), labels: readCategories(vt),
    created: created ? outTs(created.toJSDate()) : ZERO, updated: updated ? outTs(updated.toJSDate()) : ZERO,
  }
}

// ---- tiny per-user read cache to coalesce the widget stampede ----
const TTL = 12000
const cache = new Map() // sub -> { at, byUrl: Map<url, objects[]> }
function getCache(sub) { let c = cache.get(sub); if (!c || Date.now() - c.at > TTL) { c = { at: Date.now(), byUrl: new Map() }; cache.set(sub, c) } return c }
const invalidate = (sub) => cache.delete(sub)
async function fetchObjectsCached(sub, account, listUrl) {
  const c = getCache(sub)
  if (c.byUrl.has(listUrl)) return c.byUrl.get(listUrl)
  const client = await clientFor(account)
  const objs = await client.fetchCalendarObjects({ calendar: { url: listUrl }, filters: VTODO_FILTER })
  c.byUrl.set(listUrl, objs)
  return objs
}
export async function allUserVtodos(sub) {
  const lists = (await listsWithId(sub)).filter((l) => l.supports_vtodo && l.enabled)
  const out = []
  await Promise.allSettled(lists.map(async (l) => {
    try { for (const o of await fetchObjectsCached(sub, accountOf(l), l.url)) { const { vt } = safeParse(o.data); if (vt) out.push({ vt, listId: l.id, objectUrl: o.url }) } } catch { /* skip a failing list */ }
  }))
  return out
}

// GET → mutate(vcal,vt) → PUT in place (preserving foreign props); 412 → retry once.
async function getModifyPut(resolved, objectUrl, mutate, attempt = 0) {
  const r = await safeFetch(objectUrl, { headers: { Authorization: authHeader(resolved.account) } })
  if (r.status === 404) { const e = new Error('not found'); e.status = 404; throw e }
  if (!r.ok) throw new Error('fetch failed (' + r.status + ')')
  const etag = r.headers.get('etag')
  const { vcal, vt } = safeParse(await r.text())
  if (!vt) { const e = new Error('no vtodo'); e.status = 404; throw e }
  mutate(vcal, vt)
  const headers = { Authorization: authHeader(resolved.account), 'Content-Type': 'text/calendar; charset=utf-8' }
  if (etag) headers['If-Match'] = etag
  const put = await safeFetch(objectUrl, { method: 'PUT', headers, body: vcal.toString() })
  if (put.status === 412 && attempt < 1) return getModifyPut(resolved, objectUrl, mutate, attempt + 1)
  if (!put.ok && put.status !== 204) { const e = new Error('put failed (' + put.status + ')'); if (put.status === 412) e.status = 409; throw e }
  return { vcal, vt }
}

function sortTasks(tasks, sortBy = 'due_date', desc = false) {
  const key = ({ due_date: (t) => (t.due_date === ZERO ? '9999' : t.due_date), priority: (t) => t.priority, created_at: (t) => t.created, title: (t) => t.title.toLowerCase() }[sortBy]) || ((t) => (t.due_date === ZERO ? '9999' : t.due_date))
  tasks.sort((a, b) => { const ka = key(a), kb = key(b); const c = ka < kb ? -1 : ka > kb ? 1 : 0; return desc ? -c : c })
  return tasks
}

// ---- handlers (same contract as tasks.js) ----
export async function listProjects(req, res, next) {
  try {
    const uid = req.session.user.sub
    const lists = (await listsWithId(uid)).filter((l) => l.supports_vtodo && l.enabled)
    const inboxId = lists.length ? lists[0].id : null // lowest id (ORDER BY l.id)
    res.json(lists.map((l) => ({ id: l.id, title: l.display_name || l.url, hex_color: l.color || '', is_inbox: l.id === inboxId, description: '', parent_project_id: 0 })))
  } catch (e) { next(e) }
}

export async function listProjectTasks(req, res, next) {
  try {
    const uid = req.session.user.sub
    const listId = Number(req.params.id)
    const resolved = await getListById(uid, listId)
    if (!resolved || !resolved.list.supportsVtodo) return res.status(404).json({ error: 'not found' })
    const objs = await fetchObjectsCached(uid, resolved.account, resolved.list.url)
    const tasks = []
    for (const o of objs) { const { vt } = safeParse(o.data); if (vt) tasks.push(serializeVtodo(vt, listId, o.url)) }
    const per = Math.min(Number(req.query.per_page) || 250, 250)
    res.json(sortTasks(tasks).slice(0, per))
  } catch (e) { next(e) }
}

export async function listTasks(req, res, next) {
  try {
    const uid = req.session.user.sub
    const tasks = (await allUserVtodos(uid)).map(({ vt, listId, objectUrl }) => serializeVtodo(vt, listId, objectUrl))
    const per = Math.min(Number(req.query.per_page) || 250, 250)
    res.json(sortTasks(tasks, req.query.sort_by, req.query.order_by === 'desc').slice(0, per))
  } catch (e) { next(e) }
}

export async function createTask(req, res, next) {
  const uid = req.session.user.sub
  const b = req.body || {}
  const title = (b.title || '').trim()
  if (!title) return res.status(400).json({ error: 'title is required' })
  let resolved = await getListById(uid, Number(req.params.id))
  if (!resolved || !resolved.list.supportsVtodo) {
    const lists = (await listsWithId(uid)).filter((l) => l.supports_vtodo && l.enabled)
    if (!lists.length) return res.status(409).json({ error: 'no task list — connect a CalDAV account in Settings' })
    resolved = await getListById(uid, lists[0].id)
  }
  try {
    const uid2 = crypto.randomUUID()
    const vcal = new ICAL.Component('vcalendar')
    vcal.updatePropertyWithValue('prodid', '-//reminders-app//caldav//EN')
    vcal.updatePropertyWithValue('version', '2.0')
    const vt = new ICAL.Component('vtodo')
    vt.updatePropertyWithValue('uid', uid2)
    vt.updatePropertyWithValue('dtstamp', ICAL.Time.now())
    vt.updatePropertyWithValue('created', ICAL.Time.now())
    vt.updatePropertyWithValue('summary', title)
    vt.updatePropertyWithValue('status', 'NEEDS-ACTION')
    if (b.description) vt.updatePropertyWithValue('description', String(b.description))
    const pr = clampPriority(b.priority); if (pr > 0) vt.updatePropertyWithValue('priority', OUR_TO_ICAL[pr])
    const due = inDue(b.due_date); if (due) setDue(vt, due)
    if (Array.isArray(b.labels) && b.labels.length) setCategories(vt, b.labels.map((l) => l.title || l).filter(Boolean))
    if (Number(b.repeat_after) > 0 || Number(b.repeat_mode) === 1 || Number(b.repeat_mode) === 2) applyRepeatFields(vt, b.repeat_after, b.repeat_mode)
    if (Array.isArray(b.reminders)) applyReminders(vt, b.reminders)
    vcal.addSubcomponent(vt)
    const base = resolved.list.url.endsWith('/') ? resolved.list.url : resolved.list.url + '/'
    const objectUrl = base + uid2 + '.ics'
    const put = await safeFetch(objectUrl, { method: 'PUT', headers: { Authorization: authHeader(resolved.account), 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: vcal.toString() })
    if (!put.ok && put.status !== 201 && put.status !== 204) throw new Error('create failed (' + put.status + ')')
    invalidate(uid)
    res.status(201).json(serializeVtodo(vt, resolved.list.id, objectUrl))
  } catch (e) { console.error('caldav createTask failed:', e?.message || e); res.status(502).json({ error: 'could not create task' }) }
}

export async function patchTask(req, res, next) {
  const uid = req.session.user.sub
  let dec; try { dec = decodeTaskId(req.params.id) } catch { return res.status(400).json({ error: 'bad task id' }) }
  const b = req.body || {}
  const resolved = await getListById(uid, dec.listId)
  if (!resolved) return res.status(404).json({ error: 'not found' })
  try {
    const out = await getModifyPut(resolved, dec.objectUrl, (vcal, vt) => {
      if ('title' in b) { const t = (b.title || '').trim(); if (!t) { const e = new Error('title cannot be empty'); e.status = 400; throw e } vt.updatePropertyWithValue('summary', t) }
      if ('description' in b) { if (b.description) vt.updatePropertyWithValue('description', String(b.description)); else vt.removeAllProperties('description') }
      if ('priority' in b) { const pr = clampPriority(b.priority); vt.removeAllProperties('priority'); if (pr > 0) vt.updatePropertyWithValue('priority', OUR_TO_ICAL[pr]) }
      if ('due_date' in b) setDue(vt, inDue(b.due_date))
      if ('repeat_after' in b || 'repeat_mode' in b) { const cur = repeatFieldsFromVtodo(vt); applyRepeatFields(vt, 'repeat_after' in b ? b.repeat_after : cur.repeat_after, 'repeat_mode' in b ? b.repeat_mode : cur.repeat_mode) }
      if ('labels' in b) setCategories(vt, (Array.isArray(b.labels) ? b.labels : []).map((l) => l.title || l).filter(Boolean))
      if ('reminders' in b) applyReminders(vt, b.reminders)
      if ('done' in b) {
        const curDone = String(vt.getFirstPropertyValue('status') || '').toUpperCase() === 'COMPLETED'
        if (b.done && !curDone && isRecurring(vt)) { registerTimezones(vcal); advanceRecurringVtodo(vt, ICAL.Time.now()) }
        else if (b.done) { vt.updatePropertyWithValue('status', 'COMPLETED'); vt.updatePropertyWithValue('percent-complete', 100); vt.updatePropertyWithValue('completed', ICAL.Time.now()) }
        else { vt.updatePropertyWithValue('status', 'NEEDS-ACTION'); vt.updatePropertyWithValue('percent-complete', 0); vt.removeAllProperties('completed') }
      }
      vt.updatePropertyWithValue('last-modified', ICAL.Time.now()); vt.updatePropertyWithValue('dtstamp', ICAL.Time.now())
    })
    invalidate(uid)
    res.json(serializeVtodo(out.vt, dec.listId, dec.objectUrl))
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    if (e.status === 404) return res.status(404).json({ error: 'not found' })
    console.error('caldav patchTask failed:', e?.message || e)
    res.status(e.status === 409 ? 409 : 502).json({ error: 'could not update task' })
  }
}

export async function deleteTask(req, res, next) {
  const uid = req.session.user.sub
  let dec; try { dec = decodeTaskId(req.params.id) } catch { return res.status(400).json({ error: 'bad task id' }) }
  const resolved = await getListById(uid, dec.listId)
  if (!resolved) return res.status(404).json({ error: 'not found' })
  try {
    let etag
    try { const r = await safeFetch(dec.objectUrl, { headers: { Authorization: authHeader(resolved.account) } }); if (r.ok) etag = r.headers.get('etag') } catch { /* unconditional delete */ }
    const headers = { Authorization: authHeader(resolved.account) }; if (etag) headers['If-Match'] = etag
    const del = await safeFetch(dec.objectUrl, { method: 'DELETE', headers })
    if (!del.ok && del.status !== 204 && del.status !== 404) throw new Error('delete failed (' + del.status + ')')
    invalidate(uid)
    res.json({ ok: true, message: 'Successfully deleted.' })
  } catch (e) { console.error('caldav deleteTask failed:', e?.message || e); res.status(502).json({ error: 'could not delete task' }) }
}

export async function listLabels(req, res, next) {
  try {
    const set = new Set()
    for (const { vt } of await allUserVtodos(req.session.user.sub)) for (const c of readCategories(vt)) set.add(c.title)
    res.json([...set].sort().map((title) => ({ id: encodeLabelId(title), title, hex_color: '' })))
  } catch (e) { next(e) }
}

export async function createLabel(req, res) {
  const title = (req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'title is required' })
  res.json({ id: encodeLabelId(title), title, hex_color: '' }) // CATEGORIES are free text — no server object
}

export async function attachLabel(req, res) {
  const uid = req.session.user.sub
  let dec; try { dec = decodeTaskId(req.params.id) } catch { return res.status(400).json({ error: 'bad task id' }) }
  const raw = req.body?.label_id
  const name = (typeof raw === 'string' && raw.startsWith('cat_')) ? decodeLabelId(raw) : String(req.body?.title || raw || '').trim()
  if (!name) return res.status(400).json({ error: 'label required' })
  const resolved = await getListById(uid, dec.listId)
  if (!resolved) return res.status(404).json({ error: 'not found' })
  try {
    await getModifyPut(resolved, dec.objectUrl, (vcal, vt) => {
      const cur = readCategories(vt).map((c) => c.title)
      if (!cur.includes(name)) setCategories(vt, [...cur, name])
      vt.updatePropertyWithValue('last-modified', ICAL.Time.now())
    })
    invalidate(uid)
    res.json({ ok: true, label_id: encodeLabelId(name) })
  } catch (e) { console.error('caldav attachLabel failed:', e?.message || e); res.status(502).json({ error: 'could not attach label' }) }
}
