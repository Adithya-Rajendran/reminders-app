// A tiny shared read-through cache for cheap, widely-read API resources
// (projects, CalDAV accounts, reminder groups). Concurrent callers coalesce
// onto one in-flight request; repeats within the TTL are served from memory;
// errors are never cached, so a failed fetch can't poison later calls. This
// sits at the capability/boot layer (Dashboard/App) — widgets keep calling
// their capabilities as before and just stop stampeding the BFF.
// Pure factory (injectable clock) so the framework-free node tests exercise
// it; the app shares the `appCache` singleton.
export function createFetchCache(now = Date.now) {
  const entries = new Map() // key -> { promise } (in-flight) | { at, value } (settled)
  async function cached(key, fetcher, { ttl = 30_000 } = {}) {
    const e = entries.get(key)
    if (e) {
      if (e.promise) return e.promise
      if (now() - e.at < ttl) return e.value
    }
    const p = Promise.resolve().then(fetcher).then(
      (value) => { entries.set(key, { at: now(), value }); return value },
      (err) => { entries.delete(key); throw err },
    )
    entries.set(key, { promise: p })
    return p
  }
  // Drop a key or a key prefix ('' clears everything, like clear()).
  function invalidate(prefix = '') {
    for (const k of [...entries.keys()]) { if (k === prefix || k.startsWith(prefix)) entries.delete(k) }
  }
  return { cached, invalidate, clear: () => entries.clear() }
}

export const appCache = createFetchCache()
