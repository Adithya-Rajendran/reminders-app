// Notice bus (client/src/notices.js): emit/subscribe/unsubscribe, dead-handler
// isolation. Run with: node test/notices.test.mjs
import { emitNotice, onNotice } from '../client/src/notices.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- basic emit + subscribe ----
{
  const received = []
  const off = onNotice((n) => received.push(n))
  emitNotice({ kind: 'info', label: 'hello' })
  off()
  ok(received.length === 1 && received[0].label === 'hello', 'subscriber receives emitted notice')
}

// ---- unsubscribe stops delivery ----
{
  const received = []
  const off = onNotice((n) => received.push(n))
  off()
  emitNotice({ kind: 'info', label: 'after unsubscribe' })
  ok(received.length === 0, 'unsubscribed handler does not receive notices')
}

// ---- multiple subscribers each get the notice ----
{
  const a = [], b = []
  const offA = onNotice((n) => a.push(n))
  const offB = onNotice((n) => b.push(n))
  emitNotice({ kind: 'error', label: 'broadcast' })
  offA(); offB()
  ok(a.length === 1 && b.length === 1, 'all active subscribers receive the notice')
}

// ---- a throwing handler does not prevent other handlers from running ----
{
  const received = []
  const offBad = onNotice(() => { throw new Error('dead handler') })
  const offGood = onNotice((n) => received.push(n))
  // Should NOT throw — the bus catches dead handlers.
  let threw = false
  try { emitNotice({ kind: 'info', label: 'survivor' }) } catch { threw = true }
  offBad(); offGood()
  ok(!threw, 'emitNotice does not throw when a handler throws')
  ok(received.length === 1 && received[0].label === 'survivor', 'healthy handler still receives notice after dead handler')
}

// ---- emitting with no subscribers is a no-op ----
{
  let threw = false
  try { emitNotice({ kind: 'info', label: 'nobody home' }) } catch { threw = true }
  ok(!threw, 'emitting with no subscribers does not throw')
}

// ---- onNotice returns an unsubscribe function (idempotent) ----
{
  const received = []
  const off = onNotice((n) => received.push(n))
  off(); off() // calling off() twice must not throw
  emitNotice({ kind: 'info', label: 'idempotent' })
  ok(received.length === 0, 'double-unsubscribe is safe and effective')
}

console.log(`\nnotices.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
