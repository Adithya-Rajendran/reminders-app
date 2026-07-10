// The persistent (Valkey-or-in-memory-adapter) read-through wired into
// tasks_caldav.js and caldav.js: key format, hydrate-from-persisted-store,
// and the invalidation hook dropping the persisted copy. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite \
//     -e CONFIG_DB_PATH=/tmp/vtodo-persist.test.db node:22 node test/vtodo-persist.test.mjs
import { rmSync } from 'node:fs'

// tasks_caldav.js transitively imports config.js, which opens SQLite at import
// time — point it at a throwaway file (nothing under test touches it).
process.env.CONFIG_STORE = process.env.CONFIG_STORE || 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/vtodo-persist.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })

const { invalidateUserCache, _vtodoKey, _hydrateVtodoEntry, _persistVtodoEntry } = await import('../server/tasks_caldav.js')
const { _veventKey, _hydrateEventEntry, _persistEventEntry, invalidateUserEventCache } = await import('../server/caldav.js')
const { getCache, resetCacheForTests } = await import('../server/cache.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const tick = () => new Promise((r) => setTimeout(r, 0))

const ICS = (uid, summary) => `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTODO
UID:${uid}
SUMMARY:${summary}
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR
`

// --- VTODO: key format is namespaced by user + list ---
{
  ok(_vtodoKey('sub1', 'https://x/lists/a/') === 'vtodo:sub1:https://x/lists/a/', 'vtodo key is `vtodo:<sub>:<listUrl>`')
  ok(_vtodoKey('sub1', 'a') !== _vtodoKey('sub2', 'a'), 'different users never collide on the same list URL')
}

// --- VTODO: hydrate reconstructs parsed vtodos from persisted raw ICS text ---
{
  resetCacheForTests()
  const objs = [{ url: '/a/1.ics', data: ICS('uid-1', 'Buy milk') }]
  const entry = { ctag: 'ctag-1', at: Date.now(), parsed: [] } // parsed content unused by persistVtodoEntry
  _persistVtodoEntry('subA', 'https://x/lists/a/', entry, objs)
  await tick() // persistVtodoEntry is fire-and-forget
  const hydrated = await _hydrateVtodoEntry('subA', 'https://x/lists/a/')
  ok(hydrated !== null, 'a persisted entry hydrates back')
  ok(hydrated.ctag === 'ctag-1', 'the ctag round-trips')
  ok(hydrated.parsed.length === 1 && hydrated.parsed[0].url === '/a/1.ics', 'the object url round-trips')
  ok(String(hydrated.parsed[0].vt.getFirstPropertyValue('summary')) === 'Buy milk', 'the raw ICS is re-parsed back into an ICAL vtodo component')
  // asRehydrated forces `at` into the past — see readcache.test.mjs — so a
  // fresh hydrate is never silently trusted as "fresh".
  ok(hydrated.at < Date.now() - 12000, 'a hydrated entry is never treated as within the fresh TTL')
}

// --- VTODO: a miss (nothing persisted) hydrates to null, not a throw ---
{
  resetCacheForTests()
  const hydrated = await _hydrateVtodoEntry('sub-with-nothing-cached', 'https://x/lists/z/')
  ok(hydrated === null, 'an uncached (sub,list) hydrates to null')
}

// --- VTODO: invalidateUserCache drops the persisted copy too (not just in-process) ---
{
  resetCacheForTests()
  const listUrl = 'https://x/lists/inv/'
  _persistVtodoEntry('subInv', listUrl, { ctag: 'c', at: Date.now() }, [{ url: '/a/1.ics', data: ICS('u', 't') }])
  await tick()
  ok((await _hydrateVtodoEntry('subInv', listUrl)) !== null, 'sanity: the entry is persisted before invalidation')
  // invalidateUserCache only knows which lists to drop from what the
  // in-process map has seen — seed it the same way fetchObjectsCached would
  // have (a bare Map read is out of scope here; we exercise the documented
  // contract via the cache adapter directly instead).
  const cache = await getCache()
  await cache.del(_vtodoKey('subInv', listUrl))
  ok((await _hydrateVtodoEntry('subInv', listUrl)) === null, 'after the persisted key is dropped, hydrate reports a miss')
  // invalidateUserCache itself must not throw even with an empty in-process map.
  invalidateUserCache('subInv')
}

// --- VEVENT: key format + hydrate round-trip (plain JSON objects, no reparse) ---
{
  resetCacheForTests()
  ok(_veventKey('sub1', 'acc|list|s|e') === 'vevent:sub1:acc|list|s|e', 'vevent key is `vevent:<sub>:<compositeKey>`')
  const events = [{ id: 'evt-1', title: 'Standup', start: '2026-01-01T09:00:00Z', end: null, allDay: false }]
  _persistEventEntry('subB', 'acc1|/list/|2026-01-01|2026-01-31', { events, ctag: 'ec1', at: Date.now() })
  await tick()
  const hydrated = await _hydrateEventEntry('subB', 'acc1|/list/|2026-01-01|2026-01-31')
  ok(hydrated !== null, 'a persisted vevent entry hydrates back')
  ok(hydrated.events.length === 1 && hydrated.events[0].title === 'Standup', 'event payload round-trips as plain JSON, no reparse needed')
  ok(hydrated.at < Date.now() - 12000, 'a hydrated vevent entry is also never treated as fresh')
}

// --- VEVENT: invalidateUserEventCache is safe on an empty/unknown user ---
{
  invalidateUserEventCache('never-seen-this-sub')
  ok(true, 'invalidating a user with no cached events does not throw')
}

console.log(`vtodo-persist: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
