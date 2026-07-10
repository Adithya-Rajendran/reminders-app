// Shared read-path primitives (server/readcache.js): in-flight coalescing for
// the /api/calendar/events handler, and the fresh/ctag/report decision shared
// with the VTODO cache (whose behavior stays covered by ctagcache.test.mjs
// through the tasks_caldav re-export). Run with: node test/readcache.test.mjs
import { coalesce, cacheDecision, asRehydrated } from '../server/readcache.js'

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
  let release1, release2
  const gate1 = new Promise((r) => { release1 = r }) // gates created eagerly — fn runs on a microtask
  const gate2 = new Promise((r) => { release2 = r })
  const first = coalesce(map, 'k', () => gate1)
  map.delete('k') // external invalidation (e.g. invalidateUserEventCache purging in-flight reads)
  const second = coalesce(map, 'k', () => gate2)
  ok(second !== first, 'after eviction a new call runs fresh instead of joining the stale promise')
  release1('pre-mutation')
  await first
  await tick()
  ok(map.has('k'), 'the superseded promise settling does not delete the still-in-flight replacement')
  ok(coalesce(map, 'k', async () => 'unused') === second, 'callers keep coalescing onto the replacement')
  release2('post-mutation')
  ok(await second === 'post-mutation', 'the replacement resolves with post-mutation data')
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

// --- asRehydrated: a persisted-store entry never earns 'fresh' on its first
// use after hydration — it must clear a ctag check first, which is what
// makes read-through-Valkey safe without cross-process invalidation ---
{
  const TTL = 12000
  const now = 1_000_000
  ok(asRehydrated(null, now, TTL) === null, 'a missing entry hydrates to null (passthrough)')
  const justWritten = { parsed: ['x'], ctag: 'c1', at: now } // as if `at` were "just now"
  const rehydrated = asRehydrated(justWritten, now, TTL)
  ok(cacheDecision(rehydrated, now, TTL) !== 'fresh', 'a just-hydrated entry never decides fresh, even if its original `at` was recent')
  ok(cacheDecision(rehydrated, now, TTL) === 'ctag', 'it earns a cheap ctag check instead (assuming a ctag is present)')
  ok(rehydrated.parsed === justWritten.parsed && rehydrated.ctag === justWritten.ctag, 'the payload itself is passed through unchanged, only `at` is rewritten')
  const noCtag = asRehydrated({ parsed: [], ctag: null, at: now }, now, TTL)
  ok(cacheDecision(noCtag, now, TTL) === 'report', 'without a ctag, a rehydrated entry falls open to a full report, same as any other entry')
}

console.log(`readcache: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
