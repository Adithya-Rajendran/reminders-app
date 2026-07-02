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
