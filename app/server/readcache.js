// Shared read-path primitives for the CalDAV-backed endpoints — pure (no I/O,
// no timers) so the framework-free node tests can exercise them directly.

// Coalesce concurrent async calls by key: while a call for `key` is in flight,
// every additional caller shares its promise instead of re-running `fn` — N
// identical requests cost one upstream round-trip. The entry is dropped when
// the call settles (results are NOT cached here; pair with a cache for that),
// so a rejection can never poison later calls.
export function coalesce(map, key, fn) {
  const hit = map.get(key)
  if (hit) return hit
  const p = Promise.resolve().then(fn)
  map.set(key, p)
  // Release via .then(onDone, onDone) rather than .finally() — .finally would
  // mint a second rejected promise nobody awaits (an unhandledRejection). The
  // identity check keeps a superseded promise (evicted early by an external
  // invalidation) from deleting its replacement when it finally settles.
  const done = () => { if (map.get(key) === p) map.delete(key) }
  p.then(done, done)
  return p
}

// Pure freshness decision for a { at, ctag } cache entry: 'fresh' = reuse with
// no network, 'ctag' = a cheap Depth:0 PROPFIND decides whether the full REPORT
// can be skipped, 'report' = fetch + re-parse. Shared by the VTODO cache
// (tasks_caldav.js) and the VEVENT cache (caldav.js).
export function cacheDecision(entry, now, ttl) {
  if (!entry) return 'report'
  if (now - entry.at < ttl) return 'fresh'
  return entry.ctag ? 'ctag' : 'report'
}

// An entry hydrated from the persistent cache (Valkey, or seeded across a
// process restart) may be from a previous process life, or may even predate
// a write THIS process just made (e.g. an in-process entry was invalidated,
// but a stale Valkey copy from before the write is still within its TTL).
// Forcing `at` into the past means cacheDecision() can never return 'fresh'
// for a just-hydrated entry — it always earns at least one cheap ctag
// PROPFIND before being trusted, which is what makes read-through-Valkey
// correct without any cross-process invalidation bookkeeping. This is the
// stale-while-revalidate contract for the hot paths: serve the (possibly
// stale) cached payload once the ctag confirms it's still current, at the
// cost of one Depth:0 PROPFIND instead of a full REPORT+parse.
export function asRehydrated(entry, now, ttl) {
  if (!entry) return entry
  return { ...entry, at: now - ttl - 1 }
}
