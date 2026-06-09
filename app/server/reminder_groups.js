// Reminder group <-> calendar mapping. A group's reminders are stored as VTODOs
// in its mapped CalDAV calendar (so each group syncs as its own task list).
// Reminders themselves live in CalDAV; only the name->calendar map is in SQLite.
import crypto from 'node:crypto'
import ICAL from 'ical.js'
import { safeFetch, authHeader, createGroupCalendar, deleteCalendar } from './caldav.js'
import { asMatch } from './webdav.js'
import { listsWithId, getListById, getGroupMap, setGroupMapping, deleteGroupMapping, deleteListRow } from './config.js'
import { allUserVtodos, invalidateUserCache } from './tasks_caldav.js'

const err = (msg, status) => { const e = new Error(msg); e.status = status; return e }
const accountOf = (row) => ({ id: row.account_id, type: row.account_type, server_url: row.account_server_url, username: row.account_username, password_enc: row.account_password_enc })
const baseOf = (url) => (url.endsWith('/') ? url : url + '/')
const okPut = (s) => s.ok || s.status === 201 || s.status === 204

function catsOf(vt) {
  const out = new Set()
  for (const p of vt.getAllProperties('categories')) for (const v of (p.getValues() || [])) { const s = String(v).trim(); if (s) out.add(s) }
  return [...out]
}
function setCats(vt, names) {
  vt.removeAllProperties('categories')
  if (names.length) { const p = new ICAL.Property('categories'); p.setValues(names); vt.addProperty(p) }
}
async function fetchVcal(account, objectUrl) {
  const r = await safeFetch(objectUrl, { headers: { Authorization: authHeader(account) } })
  if (!r.ok) return null
  try {
    const vcal = new ICAL.Component(ICAL.parse(await r.text()))
    const vt = vcal.getAllSubcomponents('vtodo').find((x) => !x.getFirstProperty('recurrence-id')) || vcal.getFirstSubcomponent('vtodo')
    return vt ? { vcal, vt, etag: r.headers.get('etag') } : null
  } catch { return null }
}

const vtodoLists = async (userId) => (await listsWithId(userId)).filter((l) => l.supports_vtodo)
async function defaultList(userId) {
  const lists = (await vtodoLists(userId)).filter((l) => l.enabled)
  return lists.find((l) => /^reminders$/i.test(String(l.display_name || '').trim())) || lists[0] || null
}

// Groups = the categories in use across reminders ∪ the saved mappings.
export async function listGroups(userId) {
  const map = await getGroupMap(userId)
  const lists = await vtodoLists(userId)
  const byId = new Map(lists.map((l) => [l.id, l]))
  const counts = {}
  const names = new Set(Object.keys(map))
  for (const { vt } of await allUserVtodos(userId)) for (const c of catsOf(vt)) { names.add(c); counts[c] = (counts[c] || 0) + 1 }
  const groups = [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    const listId = map[name] || null
    const l = listId ? byId.get(listId) : null
    return { name, listId, calendar: l ? (l.display_name || l.url) : null, count: counts[name] || 0 }
  })
  const calendars = lists.filter((l) => l.enabled).map((l) => ({ id: l.id, name: l.display_name || l.url }))
  return { groups, calendars }
}

// Move every reminder tagged `groupName` (in any other calendar) into targetList,
// preserving the group tag. PUT-new-before-DELETE-old so nothing is lost.
async function migrateInto(userId, groupName, targetListId) {
  const target = await getListById(userId, targetListId)
  if (!target || !target.list.supportsVtodo) throw err('target calendar not found', 400)
  const tbase = baseOf(target.list.url)
  let moved = 0
  for (const { listId, objectUrl } of await allUserVtodos(userId)) {
    if (listId === targetListId) continue
    const src = await getListById(userId, listId)
    if (!src) continue
    const f = await fetchVcal(src.account, objectUrl)
    if (!f || !catsOf(f.vt).includes(groupName)) continue
    const put = await safeFetch(tbase + crypto.randomUUID() + '.ics', { method: 'PUT', headers: { Authorization: authHeader(target.account), 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: f.vcal.toString() })
    if (okPut(put)) { await safeFetch(objectUrl, { method: 'DELETE', headers: { Authorization: authHeader(src.account), ...(f.etag ? { 'If-Match': asMatch(f.etag) } : {}) } }); moved++ }
  }
  return moved
}

export async function mapGroup(userId, groupName, { listId, createNew } = {}) {
  const name = String(groupName || '').trim()
  if (!name) throw err('group name required', 400)
  let targetId = listId ? Number(listId) : null
  if (createNew) {
    const seed = await defaultList(userId)
    if (!seed) throw err('connect a CalDAV account first', 409)
    const url = await createGroupCalendar(accountOf(seed), name)
    const created = (await listsWithId(userId)).find((l) => baseOf(l.url) === baseOf(url))
    targetId = created ? created.id : null
    if (!targetId) throw err('calendar created but could not be resolved', 502)
  }
  if (!targetId) throw err('listId or createNew required', 400)
  await setGroupMapping(userId, name, targetId)
  invalidateUserCache(userId) // migrate off a FRESH CalDAV read, not the 12s widget cache
  const moved = await migrateInto(userId, name, targetId)
  invalidateUserCache(userId) // reflect the moves immediately in the next read
  return { name, listId: targetId, moved }
}

export async function deleteGroup(userId, groupName, deleteCalendarFlag) {
  const name = String(groupName || '').trim()
  if (!name) throw err('group name required', 400)
  invalidateUserCache(userId) // decide off a FRESH read, not the 12s widget cache
  const listId = (await getGroupMap(userId))[name] || null

  if (deleteCalendarFlag) {
    if (listId) {
      const resolved = await getListById(userId, listId)
      if (resolved) { await deleteCalendar(resolved.account, resolved.list.url); await deleteListRow(resolved.account.id, resolved.list.url) }
    }
    await deleteGroupMapping(userId, name)
    invalidateUserCache(userId)
    return { deletedCalendar: !!listId }
  }

  // Keep the reminders: strip the group tag and move them to the default calendar.
  const def = await defaultList(userId)
  const defResolved = def ? await getListById(userId, def.id) : null
  const tbase = defResolved ? baseOf(defResolved.list.url) : null
  let moved = 0
  for (const { listId: lid, objectUrl } of await allUserVtodos(userId)) {
    const src = await getListById(userId, lid)
    if (!src) continue
    const f = await fetchVcal(src.account, objectUrl)
    if (!f || !catsOf(f.vt).includes(name)) continue
    setCats(f.vt, catsOf(f.vt).filter((c) => c !== name))
    if (defResolved && lid !== def.id) {
      const put = await safeFetch(tbase + crypto.randomUUID() + '.ics', { method: 'PUT', headers: { Authorization: authHeader(defResolved.account), 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: f.vcal.toString() })
      if (okPut(put)) { await safeFetch(objectUrl, { method: 'DELETE', headers: { Authorization: authHeader(src.account), ...(f.etag ? { 'If-Match': asMatch(f.etag) } : {}) } }); moved++ }
    } else {
      // already in the default calendar — strip the tag in place (quoted If-Match!)
      const h = { Authorization: authHeader(src.account), 'Content-Type': 'text/calendar; charset=utf-8' }
      if (f.etag) h['If-Match'] = asMatch(f.etag)
      const r2 = await safeFetch(objectUrl, { method: 'PUT', headers: h, body: f.vcal.toString() })
      if (okPut(r2)) moved++
    }
  }
  await deleteGroupMapping(userId, name)
  invalidateUserCache(userId) // reflect the tag-strip + moves immediately
  return { ungrouped: moved }
}
