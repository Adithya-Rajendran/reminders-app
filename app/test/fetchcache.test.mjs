// The client's shared read-through cache (client/src/fetchcache.js): coalescing,
// TTL, error non-poisoning, prefix invalidation. Injected clock — no timers.
// Run with: node test/fetchcache.test.mjs
import { createFetchCache } from '../client/src/fetchcache.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- concurrent callers coalesce onto one fetch ---
{
  const c = createFetchCache(() => 0)
  let calls = 0
  const fetcher = async () => { calls++; return { n: calls } }
  const [a, b] = await Promise.all([c.cached('k', fetcher), c.cached('k', fetcher)])
  ok(calls === 1, 'two concurrent callers -> one fetch')
  ok(a === b && a.n === 1, 'both callers share the one value')
}

// --- TTL: fresh within, refetch after ---
{
  let now = 0
  const c = createFetchCache(() => now)
  let calls = 0
  const fetcher = async () => ++calls
  await c.cached('k', fetcher, { ttl: 1000 })
  now = 999
  ok(await c.cached('k', fetcher, { ttl: 1000 }) === 1 && calls === 1, 'within TTL -> served from memory')
  now = 1001
  ok(await c.cached('k', fetcher, { ttl: 1000 }) === 2 && calls === 2, 'past TTL -> refetched')
}

// --- errors are never cached (and propagate to every concurrent caller) ---
{
  const c = createFetchCache(() => 0)
  let calls = 0
  const boom = async () => { calls++; throw new Error('nope') }
  let rejected = 0
  await Promise.all([c.cached('k', boom).catch(() => rejected++), c.cached('k', boom).catch(() => rejected++)])
  ok(rejected === 2 && calls === 1, 'concurrent callers share the one rejection')
  ok(await c.cached('k', async () => 'recovered') === 'recovered', 'a failed fetch is not cached — the next call runs fresh')
}

// --- invalidation: exact key, prefix, and clear ---
{
  let now = 0
  const c = createFetchCache(() => now)
  let calls = 0
  const fetcher = async () => ++calls
  await c.cached('groups', fetcher)
  await c.cached('groups:archived', fetcher)
  await c.cached('projects', fetcher)
  c.invalidate('groups')
  await c.cached('groups', fetcher)
  await c.cached('groups:archived', fetcher)
  ok(calls === 5, 'invalidate(prefix) drops the key and its prefixed variants')
  ok(await c.cached('projects', fetcher) === 3 && calls === 5, 'other keys survive a prefix invalidation')
  c.clear()
  await c.cached('projects', fetcher)
  ok(calls === 6, 'clear() drops everything')
}

// --- invalidate()/clear() during an in-flight fetch wins over the late resolution ---
{
  const c = createFetchCache(() => 0)
  let calls = 0
  let release
  const gate = new Promise((r) => { release = r }) // created eagerly — the fetcher itself runs on a microtask
  const p = c.cached('k', () => gate.then(() => ++calls))
  c.invalidate('k') // e.g. the tasks bus invalidating groups mid-fetch
  release()
  ok(await p === 1, 'the in-flight caller still gets its value')
  ok(await c.cached('k', async () => ++calls) === 2, 'the settled value was NOT resurrected — the next call fetches fresh')
}
{
  const c = createFetchCache(() => 0)
  let release
  const gate = new Promise((r) => { release = r })
  const p = c.cached('k', () => gate)
  c.clear() // e.g. Settings closing mid-fetch
  const p2 = c.cached('k', async () => 'fresh') // re-populated after the clear
  release('stale')
  await p
  ok(await c.cached('k', async () => 'later') === 'fresh', 'a superseded fetch cannot evict or overwrite its replacement')
  ok(await p2 === 'fresh', 'the replacement kept its own value')
}

// --- different keys are independent ---
{
  const c = createFetchCache(() => 0)
  let calls = 0
  const fetcher = async () => ++calls
  await Promise.all([c.cached('a', fetcher), c.cached('b', fetcher)])
  ok(calls === 2, 'distinct keys each fetch once')
}

console.log(`fetchcache: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
