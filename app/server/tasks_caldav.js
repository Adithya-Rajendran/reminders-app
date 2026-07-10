// CalDAV-backed task store — same /api/{projects,tasks,labels} handlers + wire
// shape as tasks.js, but tasks live as VTODOs in the user's CalDAV server.
// projects = VTODO lists (caldav_lists.id); task.id = encodeTaskId(listId,objectUrl);
// labels = CATEGORIES. Wired into the API routes by index.js.
import crypto from 'node:crypto'
import ICAL from 'ical.js'
import { clientFor, authHeader, safeFetch, collectionCtag, VTODO_FILTER, CALDAV_PRODID, readFetchOptions } from './caldav.js'
import { cacheDecision, asRehydrated } from './readcache.js'
import { getCache } from './cache.js'
import { listsWithId, getListById, getGroupListId } from './config.js'
import { safeParse, categoryNames, setCategories } from './vtodo.js'
import { readCue, writeCue, readCueTrigger, writeCueTrigger, cleanDescription, readHabitLog, appendHabitLog, readGoalFlag, writeGoalFlag, readGoalPlan, writeGoalPlan, readParentGoal, writeParentGoal, readFlow, writeFlow, readDread, writeDread, readEstimate, writeEstimate, readArea, writeArea, readImportant, writeImportant, readClarified, writeClarified } from './vtodo_meta.js'
import { accountOf, baseOf, okPut, err } from './util.js'
import { ZERO_DATE as ZERO } from './constants.js'
import { encodeTaskId, decodeTaskId, encodeLabelId, decodeLabelId } from './taskid.js'
import { advanceRecurringVtodo, applyRepeatFields, repeatFieldsFromVtodo, isRecurring, registerTimezones } from './recurrence_caldav.js'
import { applyReminders, readReminders } from './valarm.js'

const outTs = (d) => (d && new Date(d).getUTCFullYear() > 1) ? new Date(d).toISOString() : ZERO
// Priority maps between our 0-5 scale (0 None … 5 DO NOW; higher = more urgent)
// and the iCalendar 0-9 scale (RFC 5545; 1 = highest, 9 = lowest, 0 = none).
// OUR_TO_ICAL is the exact inverse for our six values; icalToOur quantizes any
// inbound 0-9 priority back to a bucket so foreign tasks still map sensibly.
const OUR_TO_ICAL = { 0: 0, 1: 9, 2: 7, 3: 5, 4: 3, 5: 1 }
function icalToOur(p) { const n = Number(p) || 0; if (n <= 0) return 0; if (n <= 2) return 5; if (n <= 4) return 4; if (n <= 6) return 3; if (n <= 8) return 2; return 1 }
const clampPriority = (p) => { const n = Math.trunc(Number(p)); return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0 }

// ---- VTODO helpers (ICS parsing/CATEGORIES shared with reminder_groups.js via vtodo.js) ----
function inDue(v) { if (v === null || v === undefined || v === '' || v === ZERO) return null; const d = new Date(v); return (isNaN(d) || d.getUTCFullYear() <= 1) ? null : ICAL.Time.fromJSDate(d, true) }
function setDue(vt, time) { vt.removeAllProperties('due'); if (time) { const p = new ICAL.Property('due'); p.resetType('date-time'); p.setValue(time); vt.addProperty(p) } }
const readCategories = (vt) => categoryNames(vt).map((title) => ({ id: encodeLabelId(title), title, hex_color: '' }))
export function serializeVtodo(vt, listId, objectUrl) {
  const done = String(vt.getFirstPropertyValue('status') || 'NEEDS-ACTION').toUpperCase() === 'COMPLETED'
  const dueV = vt.getFirstPropertyValue('due') || vt.getFirstPropertyValue('dtstart')
  const compV = vt.getFirstPropertyValue('completed')
  const created = vt.getFirstPropertyValue('created')
  const updated = vt.getFirstPropertyValue('last-modified') || vt.getFirstPropertyValue('dtstamp')
  const rep = repeatFieldsFromVtodo(vt)
  return {
    id: encodeTaskId(listId, objectUrl), project_id: listId,
    uid: String(vt.getFirstPropertyValue('uid') || ''),
    title: String(vt.getFirstPropertyValue('summary') || '(untitled)'),
    description: cleanDescription(vt),
    done, done_at: done ? outTs(compV ? compV.toJSDate() : new Date()) : ZERO,
    due_date: dueV ? outTs(dueV.toJSDate()) : ZERO,
    priority: icalToOur(vt.getFirstPropertyValue('priority')),
    repeat_after: rep.repeat_after, repeat_mode: rep.repeat_mode,
    cue: readCue(vt), cue_trigger: readCueTrigger(vt),
    dread: readDread(vt), time_estimate: readEstimate(vt),
    // v2 organizing dimensions: single Project/Area membership, the explicit
    // importance axis, and the Capture→Clarify inbox state.
    area: readArea(vt), important: readImportant(vt), clarified: readClarified(vt),
    habit_log: readHabitLog(vt),
    is_goal: readGoalFlag(vt), goal: readParentGoal(vt), goal_plan: readGoalPlan(vt),
    flow: readFlow(vt),
    reminders: readReminders(vt), labels: readCategories(vt),
    created: created ? outTs(created.toJSDate()) : ZERO, updated: updated ? outTs(updated.toJSDate()) : ZERO,
  }
}

// ---- per-user read cache: coalesce the widget stampede + skip unchanged lists ----
// Caches the PARSED vtodos (ICAL.parse is the costly part) per list, keyed by the
// collection's ctag. Within FRESH_TTL we trust the cache outright; past it, a cheap
// Depth:0 ctag PROPFIND decides whether the full REPORT can be skipped. The 60s
// VALARM poller is the big winner: an idle tick becomes a PROPFIND per list with no
// re-download and no re-parse. Cached components are only ever read here (writes go
// through getModifyPut + invalidate), so sharing them is safe.
const FRESH_TTL = 12000
const cache = new Map() // sub -> Map<listUrl, { parsed:[{url,vt}], ctag:string|null, at:number }>
const userCache = (sub) => { let c = cache.get(sub); if (!c) { c = new Map(); cache.set(sub, c) } return c }
// Best-effort: also drop the persistent (Valkey/in-memory-adapter) copy for
// every list this process has seen for the user, so a hydrate right after this
// invalidation can't hand back a pre-write snapshot. Not required for
// correctness (asRehydrated() forces a ctag check on every hydrate, which
// would catch the upstream change too) but keeps the persisted store honest
// and avoids the extra PROPFIND when we already know the entry is dead.
// Lists this process never fetched aren't tracked here — see the single-
// replica note in cache.js/k8s docs; cross-replica invalidation is out of
// scope, the ctag check bounds staleness regardless.
export function invalidateUserCache(sub) {
  const c = cache.get(sub)
  if (c && c.size) {
    const listUrls = [...c.keys()]
    getCache().then((adapter) => Promise.all(listUrls.map((u) => adapter.del(vtodoKey(sub, u))))).catch(() => {})
  }
  cache.delete(sub)
}
const invalidate = invalidateUserCache

// The pure fresh/ctag/report decision moved to readcache.js so the VEVENT cache
// (caldav.js) shares it; re-exported here for the existing unit test's import.
export { cacheDecision } from './readcache.js'

// ---- persistent (Valkey-or-in-memory-adapter) read-through, survives restarts ----
// Raw ICS text (not the parsed ICAL.Component) is what's persisted — the
// component tree isn't JSON-serializable, and re-parsing it back from text on
// hydrate is cheap relative to the network REPORT it replaces. TTL is generous
// (irrelevant lists just age out): the ctag check on every hydrate (see
// asRehydrated in readcache.js) is what actually bounds staleness, not this TTL.
const VTODO_TTL_SEC = 7 * 24 * 3600
const vtodoKey = (sub, listUrl) => `vtodo:${sub}:${listUrl}`

async function hydrateVtodoEntry(sub, listUrl) {
  const adapter = await getCache()
  const persisted = await adapter.get(vtodoKey(sub, listUrl))
  if (!persisted || !Array.isArray(persisted.items)) return null
  const parsed = persisted.items.map(({ url, data }) => ({ url, vt: safeParse(data).vt })).filter((p) => p.vt)
  if (!parsed.length && persisted.items.length) return null // every item failed to reparse — treat as a miss
  return asRehydrated({ parsed, ctag: persisted.ctag ?? null, at: persisted.at || 0 }, Date.now(), FRESH_TTL)
}

// Fire-and-forget: never let a slow/unavailable cache backend delay the
// response that just paid for the REPORT+parse.
function persistVtodoEntry(sub, listUrl, entry, objs) {
  getCache().then((adapter) => adapter.set(
    vtodoKey(sub, listUrl),
    { ctag: entry.ctag, at: entry.at, items: objs.map((o) => ({ url: o.url, data: o.data })) },
    VTODO_TTL_SEC,
  )).catch(() => {})
}

async function fetchObjectsCached(sub, account, listUrl) {
  const c = userCache(sub)
  let entry = c.get(listUrl)
  if (!entry) {
    // Cold in-process entry (fresh boot, or evicted by invalidateUserCache) —
    // try the persistent adapter before paying for a full REPORT. asRehydrated
    // guarantees the decision below is at worst 'ctag' (one cheap PROPFIND),
    // never a silent 'fresh' hit on possibly-stale data.
    const hydrated = await hydrateVtodoEntry(sub, listUrl)
    if (hydrated) { entry = hydrated; c.set(listUrl, entry) }
  }
  const decision = cacheDecision(entry, Date.now(), FRESH_TTL)
  if (decision === 'fresh') return entry.parsed
  let knownCtag = entry?.ctag || null
  if (decision === 'ctag') {
    const cur = await collectionCtag(account, listUrl).catch(() => null)
    if (cur && cur === knownCtag) { entry.at = Date.now(); return entry.parsed } // unchanged → reuse parse
    knownCtag = cur // changed or unavailable → fall through (reseed ctag below; null = fail open)
  }
  const client = await clientFor(account)
  const objs = await client.fetchCalendarObjects({ calendar: { url: listUrl }, filters: VTODO_FILTER, fetchOptions: readFetchOptions() })
  const parsed = objs.map((o) => ({ url: o.url, vt: safeParse(o.data).vt }))
  // Reuse the ctag the change-probe already fetched; only on a cold entry do we
  // pay one extra PROPFIND to seed it.
  const ctag = knownCtag != null ? knownCtag : await collectionCtag(account, listUrl).catch(() => null)
  const fresh = { parsed, ctag, at: Date.now() }
  c.set(listUrl, fresh)
  persistVtodoEntry(sub, listUrl, fresh, objs)
  return parsed
}
export async function allUserVtodos(sub) {
  const lists = (await listsWithId(sub)).filter((l) => l.supports_vtodo && l.enabled)
  const out = []
  await Promise.allSettled(lists.map(async (l) => {
    try { for (const { url, vt } of await fetchObjectsCached(sub, accountOf(l), l.url)) { if (vt) out.push({ vt, listId: l.id, objectUrl: url }) } } catch { /* skip a failing list */ }
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

export function sortTasks(tasks, sortBy = 'due_date', desc = false) {
  const key = ({ due_date: (t) => (t.due_date === ZERO ? '9999' : t.due_date), priority: (t) => t.priority, created_at: (t) => t.created, title: (t) => t.title.toLowerCase() }[sortBy]) || ((t) => (t.due_date === ZERO ? '9999' : t.due_date))
  tasks.sort((a, b) => {
    const ka = key(a), kb = key(b)
    let c = ka < kb ? -1 : ka > kb ? 1 : 0
    // Tie-break deterministically: CalDAV listing order is filesystem-arbitrary,
    // so equal-key tasks swap between loads without a stable tie-breaker. Compare
    // title (case-insensitive), then uid, both ascending (to keep equal items
    // in a consistent order regardless of primary sort direction).
    if (c === 0) {
      const ta = a.title?.toLowerCase() || '', tb = b.title?.toLowerCase() || ''
      c = ta < tb ? -1 : ta > tb ? 1 : 0
      if (c === 0) {
        const ua = a.uid || '', ub = b.uid || ''
        c = ua < ub ? -1 : ua > ub ? 1 : 0
      }
      // Tie-break: always ascending regardless of desc flag
      return c
    }
    // Primary key differs: apply desc flag to primary sort only
    return desc ? -c : c
  })
  return tasks
}

// ---- handlers (same contract as tasks.js) ----
export async function listProjects(req, res, next) {
  try {
    const uid = req.session.user.sub
    const lists = (await listsWithId(uid)).filter((l) => l.supports_vtodo && l.enabled)
    // The "Reminders" calendar is the default; else the first list.
    const inboxId = (lists.find((l) => /^reminders$/i.test(String(l.display_name || '').trim())) || lists[0])?.id ?? null
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
    for (const { url, vt } of objs) { if (vt) tasks.push(serializeVtodo(vt, listId, url)) }
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

// createTask/patchTask/deleteTask/attachLabel respond to upstream failures
// directly (specific 4xx/502 messages the client shows) instead of next(e).

// ---- core functions (no req/res — called by HTTP handlers and the MCP tool layer) ----

// Create a new VTODO. `projectId` may be null/undefined to trigger the
// fallback-to-first-list path. Throws err(msg, status) on validation/upstream
// failure so callers can map to the appropriate response.
export async function createTaskCore(sub, projectId, body) {
  const b = body || {}
  const title = (b.title || '').trim()
  if (!title) throw err('title is required', 400)
  let resolved = await getListById(sub, Number(projectId))
  if (!resolved || !resolved.list.supportsVtodo) {
    const lists = (await listsWithId(sub)).filter((l) => l.supports_vtodo && l.enabled)
    if (!lists.length) throw err('no task list — connect a CalDAV account in Settings', 409)
    resolved = await getListById(sub, lists[0].id)
  }
  // Route by reminder group: a mapped group's reminders live in its own calendar.
  const groupName = (Array.isArray(b.labels) && b.labels.length) ? String((b.labels[0] && (b.labels[0].title || b.labels[0])) || '').trim() : ''
  if (groupName) {
    const mapped = await getGroupListId(sub, groupName)
    if (mapped) { const r2 = await getListById(sub, mapped); if (r2 && r2.list.supportsVtodo) resolved = r2 }
  }
  try {
    const uid2 = crypto.randomUUID()
    const vcal = new ICAL.Component('vcalendar')
    vcal.updatePropertyWithValue('prodid', CALDAV_PRODID)
    vcal.updatePropertyWithValue('version', '2.0')
    const vt = new ICAL.Component('vtodo')
    vt.updatePropertyWithValue('uid', uid2)
    vt.updatePropertyWithValue('dtstamp', ICAL.Time.now())
    vt.updatePropertyWithValue('created', ICAL.Time.now())
    vt.updatePropertyWithValue('summary', title)
    vt.updatePropertyWithValue('status', 'NEEDS-ACTION')
    if (b.description) vt.updatePropertyWithValue('description', String(b.description))
    if (b.cue) writeCue(vt, b.cue)
    if (b.cue_trigger) writeCueTrigger(vt, b.cue_trigger)
    if (b.dread) writeDread(vt, b.dread)
    if (b.time_estimate) writeEstimate(vt, b.time_estimate)
    if (b.is_goal) writeGoalFlag(vt, true)
    if (b.goal_plan) writeGoalPlan(vt, b.goal_plan)
    if (b.goal_uid) writeParentGoal(vt, b.goal_uid)
    if (b.flow) writeFlow(vt, b.flow)
    if (b.area) writeArea(vt, b.area)
    if (b.important) writeImportant(vt, true)
    if (b.clarified) writeClarified(vt, true)
    const pr = clampPriority(b.priority); if (pr > 0) vt.updatePropertyWithValue('priority', OUR_TO_ICAL[pr])
    const due = inDue(b.due_date); if (due) setDue(vt, due)
    if (Array.isArray(b.labels) && b.labels.length) setCategories(vt, b.labels.map((l) => l.title || l).filter(Boolean))
    if (Number(b.repeat_after) > 0 || Number(b.repeat_mode) === 1 || Number(b.repeat_mode) === 2) applyRepeatFields(vt, b.repeat_after, b.repeat_mode)
    if (Array.isArray(b.reminders)) applyReminders(vt, b.reminders)
    vcal.addSubcomponent(vt)
    const objectUrl = baseOf(resolved.list.url) + uid2 + '.ics'
    const put = await safeFetch(objectUrl, { method: 'PUT', headers: { Authorization: authHeader(resolved.account), 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: vcal.toString() })
    if (!okPut(put)) { const e = new Error('create failed (' + put.status + ')'); e.status = put.status; throw e }
    invalidate(sub)
    return serializeVtodo(vt, resolved.list.id, objectUrl)
  } catch (e) {
    console.error('caldav createTask failed:', e?.message || e)
    if (e.status === 403) throw err('That list is read-only — choose a writable list.', 403)
    throw err('could not create task', 502)
  }
}

// Patch an existing VTODO. `taskId` is the encoded task id. Throws err(msg, status).
export async function patchTaskCore(sub, taskId, body) {
  let dec; try { dec = decodeTaskId(taskId) } catch { throw err('bad task id', 400) }
  const b = body || {}
  const resolved = await getListById(sub, dec.listId)
  if (!resolved) throw err('not found', 404)
  try {
    const out = await getModifyPut(resolved, dec.objectUrl, (vcal, vt) => {
      if ('title' in b) { const t = (b.title || '').trim(); if (!t) { const e = new Error('title cannot be empty'); e.status = 400; throw e } vt.updatePropertyWithValue('summary', t) }
      if ('description' in b) { if (b.description) vt.updatePropertyWithValue('description', String(b.description)); else vt.removeAllProperties('description') }
      if ('cue' in b) writeCue(vt, b.cue)
      if ('cue_trigger' in b) writeCueTrigger(vt, b.cue_trigger)
      if ('dread' in b) writeDread(vt, b.dread)
      if ('time_estimate' in b) writeEstimate(vt, b.time_estimate)
      if ('is_goal' in b) writeGoalFlag(vt, !!b.is_goal)
      if ('goal_plan' in b) writeGoalPlan(vt, b.goal_plan)
      if ('goal_uid' in b) writeParentGoal(vt, b.goal_uid)
      if ('flow' in b) writeFlow(vt, b.flow)
      if ('area' in b) writeArea(vt, b.area)
      if ('important' in b) writeImportant(vt, !!b.important)
      if ('clarified' in b) writeClarified(vt, !!b.clarified)
      if ('priority' in b) { const pr = clampPriority(b.priority); vt.removeAllProperties('priority'); if (pr > 0) vt.updatePropertyWithValue('priority', OUR_TO_ICAL[pr]) }
      if ('due_date' in b) setDue(vt, inDue(b.due_date))
      if ('repeat_after' in b || 'repeat_mode' in b) { const cur = repeatFieldsFromVtodo(vt); applyRepeatFields(vt, 'repeat_after' in b ? b.repeat_after : cur.repeat_after, 'repeat_mode' in b ? b.repeat_mode : cur.repeat_mode) }
      if ('labels' in b) setCategories(vt, (Array.isArray(b.labels) ? b.labels : []).map((l) => l.title || l).filter(Boolean))
      if ('reminders' in b) applyReminders(vt, b.reminders)
      if ('done' in b) {
        const curDone = String(vt.getFirstPropertyValue('status') || '').toUpperCase() === 'COMPLETED'
        if (b.done && !curDone && isRecurring(vt)) {
          registerTimezones(vcal)
          const now = ICAL.Time.now()
          const advResult = advanceRecurringVtodo(vt, now)
          // Record the completion day for habit streaks — but only when an
          // occurrence was actually completed (advanced to the next one, or the
          // final one for a finite recurrence). A no-op advance (e.g. no anchor)
          // didn't complete anything, so it must not be logged. Fires exactly
          // once per real completion → no double-count against the wire path.
          if (advResult.advanced || advResult.done) appendHabitLog(vt, now.toJSDate().toISOString().slice(0, 10))
        }
        else if (b.done) { vt.updatePropertyWithValue('status', 'COMPLETED'); vt.updatePropertyWithValue('percent-complete', 100); vt.updatePropertyWithValue('completed', ICAL.Time.now()) }
        else { vt.updatePropertyWithValue('status', 'NEEDS-ACTION'); vt.updatePropertyWithValue('percent-complete', 0); vt.removeAllProperties('completed') }
      }
      vt.updatePropertyWithValue('last-modified', ICAL.Time.now()); vt.updatePropertyWithValue('dtstamp', ICAL.Time.now())
    })
    invalidate(sub)
    return serializeVtodo(out.vt, dec.listId, dec.objectUrl)
  } catch (e) {
    if (e.status === 400) throw err(e.message, 400)
    if (e.status === 404) throw err('not found', 404)
    console.error('caldav patchTask failed:', e?.message || e)
    throw err('could not update task', e.status === 409 ? 409 : 502)
  }
}

// Delete a VTODO. `taskId` is the encoded task id. Throws err(msg, status).
export async function deleteTaskCore(sub, taskId) {
  let dec; try { dec = decodeTaskId(taskId) } catch { throw err('bad task id', 400) }
  const resolved = await getListById(sub, dec.listId)
  if (!resolved) throw err('not found', 404)
  try {
    let etag
    try { const r = await safeFetch(dec.objectUrl, { headers: { Authorization: authHeader(resolved.account) } }); if (r.ok) etag = r.headers.get('etag') } catch { /* unconditional delete */ }
    const headers = { Authorization: authHeader(resolved.account) }; if (etag) headers['If-Match'] = etag
    const del = await safeFetch(dec.objectUrl, { method: 'DELETE', headers })
    if (!del.ok && del.status !== 204 && del.status !== 404) throw new Error('delete failed (' + del.status + ')')
    invalidate(sub)
    return { ok: true }
  } catch (e) { console.error('caldav deleteTask failed:', e?.message || e); throw err('could not delete task', 502) }
}

// ---- HTTP handlers — thin wrappers over the core functions ----

export async function createTask(req, res) {
  try {
    const result = await createTaskCore(req.session.user.sub, req.params.id, req.body)
    res.status(201).json(result)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    if (e.status === 403) return res.status(403).json({ error: e.message })
    if (e.status === 409) return res.status(409).json({ error: e.message })
    res.status(502).json({ error: e.message || 'could not create task' })
  }
}

export async function patchTask(req, res) {
  try {
    const result = await patchTaskCore(req.session.user.sub, req.params.id, req.body)
    res.json(result)
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    if (e.status === 404) return res.status(404).json({ error: 'not found' })
    if (e.status === 409) return res.status(409).json({ error: e.message })
    res.status(502).json({ error: e.message || 'could not update task' })
  }
}

export async function deleteTask(req, res) {
  try {
    await deleteTaskCore(req.session.user.sub, req.params.id)
    res.json({ ok: true, message: 'Successfully deleted.' })
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message })
    if (e.status === 404) return res.status(404).json({ error: 'not found' })
    res.status(502).json({ error: e.message || 'could not delete task' })
  }
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

// exported for tests only — the persistent VTODO read-through (hydrate on a
// cold in-process entry, persist after a real fetch, key format).
export { vtodoKey as _vtodoKey, hydrateVtodoEntry as _hydrateVtodoEntry, persistVtodoEntry as _persistVtodoEntry }
