// server/ratelimit.js — lazy token bucket + per-user middleware. Run: node test/ratelimit.test.mjs
import { TokenBucket, rateLimitMiddleware } from '../server/ratelimit.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- TokenBucket ---
const b = new TokenBucket(3, 0) // no refill
ok(b.consume() && b.consume() && b.consume(), 'consumes up to capacity (3)')
ok(!b.consume(), 'denies once exhausted')
ok(b.full() === false, 'full() is false when drained')

const r = new TokenBucket(2, 2 / 60000) // 2 per minute
r.consume(); r.consume()
ok(!r.consume(), 'exhausted at capacity 2')
r.last = Date.now() - 70000 // simulate 70s elapsed -> refills to capacity
ok(r.consume(), 'refills after enough time elapses')
ok(new TokenBucket(2, 999).full(), 'full() true at capacity')

// --- middleware ---
const mw = rateLimitMiddleware(1) // 1 per minute, per sub
const req = (sub) => ({ session: { user: { sub } } })
const res = () => { const o = {}; o.code = null; o.body = null; o.status = (c) => { o.code = c; return o }; o.json = (x) => { o.body = x; return o }; return o }

let n = 0; mw(req('a'), res(), () => { n++ })
ok(n === 1, 'first request for a -> next() called')
const r2 = res(); let n2 = 0; mw(req('a'), r2, () => { n2++ })
ok(n2 === 0 && r2.code === 429 && /too many/i.test(r2.body?.error || ''), 'second request for a -> 429, next() NOT called')
let n3 = 0; mw(req('b'), res(), () => { n3++ })
ok(n3 === 1, 'sub b has its own bucket (isolated)')
let n4 = 0; mw({ session: {} }, res(), () => { n4++ })
ok(n4 === 1, 'missing sub -> passes through (defensive; requireAuth gates first)')

console.log(`\nratelimit.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
