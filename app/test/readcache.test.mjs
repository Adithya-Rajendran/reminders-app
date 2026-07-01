// Shared read-path primitives (server/readcache.js): in-flight coalescing for
// the /api/calendar/events handler, and the fresh/ctag/report decision shared
// with the VTODO cache (whose behavior stays covered by ctagcache.test.mjs
// through the tasks_caldav re-export). Run with: node test/readcache.test.mjs
import { coalesce, cacheDecision } from '../server/readcache.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const tick = () => new Promise((r) => setTimeout(r, 0))

// --- coalesce: concurrent callers share ONE in-flight call ---
{
  const map = new Map()
  let calls = 0
  let release
  const gate = new Promise((r) => { release = r })
  const fn = async () => { calls++; await gate; return 'result' }
  const p1 = coalesce(map, 'k', fn)
  const p2 = coalesce(map, 'k', fn)
  ok(p1 === p2, 'second caller shares the first caller\'s promise')
  ok(map.has('k'), 'the in-flight entry is registered under its key')
  release()
  const [r1, r2] = await Promise.all([p1, p2])
  ok(r1 === 'result' && r2 === 'result', 'both callers get the one result')
  ok(calls === 1, 'the underlying fn ran exactly once')
  await tick()
  ok(!map.has('k'), 'the key is released once the call settles')
  // After release, a new call runs fresh (results are not cached here).
  await coalesce(map, 'k', fn)
  ok(calls === 2, 'a call after settle runs the fn again (no result caching)')
}

// --- coalesce: an externally-evicted (invalidated) promise can't evict its replacement ---
{
  const map = new Map()
  let release1
  const first = coalesce(map, 'k', () => new Promise((r) => { release1 = r }))
  map.delete('k') // external invalidation (e.g. invalidateUserEventCache purging in-flight reads)
  const second = coalesce(map, 'k', async () => 'post-mutation')
  ok(second !== first, 'after eviction a new call runs fresh instead of joining the stale promise')
  release1('pre-mutation')
  await first
  await tick()
  ok(map.has('k'), 'the superseded promise settling does not delete the replacement key')
  ok(await coalesce(map, 'k', async () => 'unused') === 'post-mutation', 'callers keep coalescing onto the replacement')
}

// --- coalesce: distinct keys are independent ---
{
  const map = new Map()
  let calls = 0
  const fn = async () => ++calls
  const [a, b] = await Promise.all([coalesce(map, 'a', fn), coalesce(map, 'b', fn)])
  ok(a !== b && calls === 2, 'different keys each run their own call')
}

// --- coalesce: a rejection propagates to every caller and never poisons the key ---
{
  const map = new Map()
  let calls = 0
  const boom = async () => { calls++; throw new Error('nope') }
  const p1 = coalesce(map, 'k', boom)
  const p2 = coalesce(map, 'k', boom)
  let rejected = 0
  await Promise.all([p1.catch(() => rejected++), p2.catch(() => rejected++)])
  ok(rejected === 2 && calls === 1, 'both concurrent callers see the one rejection')
  await tick()
  ok(!map.has('k'), 'a rejected call releases its key')
  const r = await coalesce(map, 'k', async () => 'recovered')
  ok(r === 'recovered', 'the next call after a rejection runs fresh')
}

// --- cacheDecision: fresh / ctag / report (shared by VTODO + VEVENT caches) ---
{
  const TTL = 12000
  const entry = (at, ctag) => ({ at, ctag })
  ok(cacheDecision(null, 1000, TTL) === 'report', 'no entry -> report')
  ok(cacheDecision(entry(1000, 'x'), 1000 + TTL - 1, TTL) === 'fresh', 'inside TTL -> fresh')
  ok(cacheDecision(entry(1000, 'x'), 1000 + TTL + 1, TTL) === 'ctag', 'past TTL with ctag -> probe')
  ok(cacheDecision(entry(1000, null), 1000 + TTL + 1, TTL) === 'report', 'past TTL without ctag -> report')
}

console.log(`readcache: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
