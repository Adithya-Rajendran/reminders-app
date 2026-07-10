// Thin cache adapter shared by the CalDAV/notes read paths. Two backends
// behind one interface:
//   - VALKEY_URL set   -> Valkey (iovalkey, ioredis-compatible client)
//   - VALKEY_URL unset -> in-process Map with TTL sweeping (the default; dev/
//     CI/tests need no external service)
// The adapter must never be the reason the app goes down: a Valkey outage
// (connect failure, timeout, command error) logs ONCE per outage and falls
// back to the in-memory backend for the duration — callers never see the
// difference beyond a lost cache entry.
//
// Keys are namespaced (`rmdrs:<key>`) so this process's cache can share a
// Valkey instance with other tenants/tools without collisions. Values are
// JSON-encoded; callers pass/receive plain JS values.

const NAMESPACE = 'rmdrs:'

// Redact credentials before any URL touches a log line — VALKEY_URL may carry
// a password (redis://:secret@host:port).
export function redactUrl(url) {
  if (!url) return url
  try {
    const u = new URL(url)
    if (u.password) u.password = '***'
    if (u.username) u.username = '***'
    return u.toString()
  } catch { return '<unparseable-url>' }
}

// ---- in-memory backend (default; also the Valkey fallback target) ----
export class MemoryBackend {
  constructor() {
    this.map = new Map() // key -> { value: string, exp: number|null }
  }
  // Exposed as a method (not a constructor side effect) so tests can call it
  // deterministically instead of racing a real timer.
  sweep(now = Date.now()) {
    for (const [k, e] of this.map) { if (e.exp !== null && e.exp <= now) this.map.delete(k) }
  }
  async get(key) {
    const e = this.map.get(key)
    if (!e) return null
    if (e.exp !== null && e.exp <= Date.now()) { this.map.delete(key); return null }
    return e.value
  }
  async set(key, value, ttlSec) {
    this.map.set(key, { value, exp: ttlSec ? Date.now() + ttlSec * 1000 : null })
  }
  async del(key) { this.map.delete(key) }
}

// ---- Valkey-backed adapter with transparent in-memory fallback ----
// `ValkeyClient` is injectable for tests; production callers get the real
// iovalkey client via connectValkey().
class ValkeyBackend {
  constructor(client, { onErrorOnce } = {}) {
    this.client = client
    this.fallback = new MemoryBackend()
    this.outage = false
    this.onErrorOnce = onErrorOnce || (() => {})
  }
  #fail(e) {
    if (!this.outage) { this.outage = true; this.onErrorOnce(e) }
  }
  #recover() { this.outage = false }
  async get(key) {
    try {
      const v = await this.client.get(key)
      this.#recover()
      if (v !== null && v !== undefined) return v
      // Miss upstream doesn't imply miss in the fallback (e.g. written during
      // a prior outage and not yet reconciled) — check it too.
      return this.fallback.get(key)
    } catch (e) { this.#fail(e); return this.fallback.get(key) }
  }
  async set(key, value, ttlSec) {
    // Always mirror into the fallback so a mid-request Valkey blip doesn't
    // erase a value the caller believes was cached.
    this.fallback.set(key, value, ttlSec)
    try {
      if (ttlSec) await this.client.set(key, value, 'EX', ttlSec)
      else await this.client.set(key, value)
      this.#recover()
    } catch (e) { this.#fail(e) }
  }
  async del(key) {
    this.fallback.del(key)
    try { await this.client.del(key); this.#recover() } catch (e) { this.#fail(e) }
  }
}

// Lazily require iovalkey so environments/tests that never set VALKEY_URL
// don't pay for loading the client at all.
async function connectValkey(url, logger, clientFactory) {
  let client
  if (clientFactory) {
    client = clientFactory(url) // test seam — bypasses the real iovalkey import/connection
  } else {
    const { default: Valkey } = await import('iovalkey')
    client = new Valkey(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1, // fail fast to the in-memory fallback rather than queueing
      retryStrategy: (times) => Math.min(times * 500, 5000),
    })
  }
  let loggedConnErrorOnce = false
  client.on('error', (e) => {
    // ioredis/iovalkey emit 'error' repeatedly during an outage (one per
    // reconnect attempt) — the adapter's own #fail/#recover already logs
    // once per outage for command failures; this handler only silences the
    // unhandled-error-event crash risk and adds one log line if we haven't
    // already reported this outage via a command failure.
    if (!loggedConnErrorOnce) { loggedConnErrorOnce = true; logger(`[cache] Valkey connection error (falling back to in-memory): ${e?.message || e}`) }
  })
  client.on('connect', () => { loggedConnErrorOnce = false })
  try { await client.connect() } catch { /* on-demand commands will retry/report via 'error' */ }
  return client
}

// Build the adapter. `url`/`logger` are injectable for tests; production
// callers use the zero-arg form. `_clientFactory` is a test-only seam that
// swaps in a fake ioredis-shaped client instead of a real iovalkey connection.
export async function createCache({ url = process.env.VALKEY_URL, logger = console.error, _clientFactory = null } = {}) {
  if (!url) {
    const mem = new MemoryBackend()
    const timer = setInterval(() => mem.sweep(), 30_000)
    timer.unref?.()
    return wrapNamespaced(mem)
  }
  const redacted = redactUrl(url)
  let backend
  try {
    const client = await connectValkey(url, logger, _clientFactory)
    backend = new ValkeyBackend(client, {
      onErrorOnce: (e) => logger(`[cache] Valkey unavailable (${redacted}), falling back to in-memory: ${e?.message || e}`),
    })
  } catch (e) {
    logger(`[cache] could not initialize Valkey client (${redacted}), using in-memory cache: ${e?.message || e}`)
    backend = new MemoryBackend()
  }
  return wrapNamespaced(backend)
}

// Process-wide singleton: every read-path module calls getCache() and awaits
// the same connect-or-fallback resolution instead of each opening its own
// Valkey connection.
let cachePromise = null
export function getCache() {
  if (!cachePromise) cachePromise = createCache()
  return cachePromise
}
// Test-only: force a fresh singleton (e.g. after mutating process.env.VALKEY_URL).
export function resetCacheForTests() { cachePromise = null }

function wrapNamespaced(backend) {
  const nsKey = (key) => NAMESPACE + key
  return {
    async get(key) {
      const raw = await backend.get(nsKey(key))
      if (raw === null || raw === undefined) return null
      try { return JSON.parse(raw) } catch { return null } // corrupt entry -> treat as miss
    },
    async set(key, value, ttlSec) {
      await backend.set(nsKey(key), JSON.stringify(value), ttlSec)
    },
    async del(key) { await backend.del(nsKey(key)) },
    // Escape hatch for tests / diagnostics only.
    _backend: backend,
  }
}
