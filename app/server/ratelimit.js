// Tiny dependency-free per-user rate limiter for the expensive CalDAV routes
// (account add + discover make outbound PROPFINDs, so an authed user shouldn't be
// able to spam them / probe allowed hosts). Lazy token-bucket: no timers, refill
// is computed from elapsed time on each request.

export class TokenBucket {
  constructor(capacity, refillPerMs) {
    this.capacity = capacity
    this.tokens = capacity
    this.refillPerMs = refillPerMs
    this.last = Date.now()
  }
  consume(n = 1) {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs)
    this.last = now
    if (this.tokens >= n) { this.tokens -= n; return true }
    return false
  }
  full() { return this.tokens >= this.capacity }
}

// Per-user buckets keyed on the OIDC sub (or whatever keyFn returns). A
// module-level Map (NOT a WeakMap on req.session.user — express-session
// rehydrates a fresh user object per request, so a WeakMap keyed on it would
// never hit). Bounded by an opportunistic sweep of full (idle) buckets so it
// can't grow without limit.
//
// keyFn lets callers key on something other than the OIDC sub (e.g. an MCP
// token id, an IP address for anonymous routes). Falsy return -> skip limiting;
// this matches the original behaviour where a missing sub bypasses the check
// (requireAuth already guards the route; this is a second layer).
export function rateLimitMiddleware(perMin, keyFn = (req) => req.session?.user?.sub) {
  const capacity = Math.max(1, perMin)
  const refillPerMs = perMin / 60000
  const buckets = new Map()
  return (req, res, next) => {
    const sub = keyFn(req)
    if (!sub) return next() // requireAuth runs first; this is just defensive
    if (buckets.size > 5000) for (const [k, v] of buckets) { if (v.full()) buckets.delete(k) }
    let b = buckets.get(sub)
    if (!b) { b = new TokenBucket(capacity, refillPerMs); buckets.set(sub, b) }
    if (!b.consume()) return res.status(429).json({ error: 'Too many requests — slow down and try again in a moment.' })
    return next()
  }
}
