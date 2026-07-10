// server/cache.js — the in-memory backend (the default, and the automatic
// fallback target when Valkey errors), namespacing, JSON round-trip, TTL
// expiry, and the Valkey-backend fallback contract (no real Valkey in CI —
// a fake client stands in for it). Run with: node test/cache.test.mjs
import { MemoryBackend, redactUrl, createCache } from '../server/cache.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- redactUrl: never let a credential reach a log line ---
{
  ok(redactUrl('redis://:s3cret@host:6379') === 'redis://:***@host:6379', 'password is redacted')
  ok(redactUrl('redis://user:pw@host:6379/0').includes('***') && !redactUrl('redis://user:pw@host:6379/0').includes('pw'), 'username+password both redacted')
  ok(redactUrl('redis://host:6379') === 'redis://host:6379', 'a credential-free URL round-trips')
  ok(redactUrl('not a url') === '<unparseable-url>', 'an unparseable URL fails safe, never throws')
  ok(redactUrl(null) === null, 'falsy input passes through')
}

// --- MemoryBackend: TTL expiry, get/set/del, sweep ---
{
  const m = new MemoryBackend()
  await m.set('a', 'v1', null)
  ok(await m.get('a') === 'v1', 'no-TTL set is retrievable')
  await m.set('b', 'v2', 10) // 10s TTL
  ok(await m.get('b') === 'v2', 'TTL-set entry is retrievable before expiry')
  await m.set('c', 'v3', 10)
  m.sweep(Date.now() + 20_000) // fast-forward past the TTL without a real timer
  ok(await m.get('c') === null, 'sweep evicts an expired entry')
  ok(m.map.has('a'), 'sweep leaves a no-TTL entry alone')
  await m.del('a')
  ok(await m.get('a') === null, 'del removes an entry')
  ok(await m.get('nope') === null, 'a miss returns null, not undefined/throw')
}

// --- MemoryBackend: lazy expiry also applies on get (no sweep needed) ---
{
  const m = new MemoryBackend()
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  try {
    await m.set('k', 'v', 5) // expires at 1_005_000
    now = 1_006_000
    ok(await m.get('k') === null, 'get() itself lazily expires a stale entry')
    ok(!m.map.has('k'), 'the lazily-expired entry is also removed from the map')
  } finally { Date.now = realNow }
}

// --- createCache(): default (no url) namespaces keys and round-trips JSON ---
{
  const cache = await createCache({ url: null })
  await cache.set('user:1', { name: 'a', nested: [1, 2, 3] }, 60)
  const v = await cache.get('user:1')
  ok(v && v.name === 'a' && Array.isArray(v.nested) && v.nested.length === 3, 'JSON value round-trips through get/set')
  ok(cache._backend.map.has('rmdrs:user:1'), 'keys are namespaced under the shared prefix')
  await cache.del('user:1')
  ok(await cache.get('user:1') === null, 'del removes the namespaced key')
  ok(await cache.get('never-set') === null, 'a miss is null, not an exception')
}

// --- createCache(): a Valkey backend that errors on every call falls back to
// in-memory transparently, logs once, and never throws to the caller ---
{
  let calls = 0
  const boomClient = {
    async connect() { /* lazyConnect succeeds; commands fail */ },
    on() {},
    async get() { calls++; throw new Error('ECONNREFUSED') },
    async set() { calls++; throw new Error('ECONNREFUSED') },
    async del() { calls++; throw new Error('ECONNREFUSED') },
  }
  const logs = []
  const cache = await createCache({ url: 'redis://:pw@bad-host:6379', logger: (m) => logs.push(m), _clientFactory: () => boomClient })
  await cache.set('x', 42, 60)
  ok(await cache.get('x') === 42, 'set/get still work via the in-memory fallback despite Valkey erroring on every call')
  await cache.del('x')
  ok(await cache.get('x') === null, 'del also falls back cleanly')
  ok(calls >= 3, 'the Valkey client was actually attempted, not skipped')
  ok(logs.length === 1, 'exactly one log line for the whole outage, not one per failed call')
  ok(!logs[0].includes('pw'), 'the logged line never contains the raw credential')
}

console.log(`cache: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
