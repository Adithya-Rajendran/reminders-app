// Serialized save queue (client/src/savequeue.js): overlap coalescing, retry-on-
// error dirtiness, and state callbacks. Run with: node test/savequeue.test.mjs
import { createSaveQueue } from '../client/src/savequeue.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const tick = () => new Promise((r) => setTimeout(r, 0))

// ---- a clean queue doesn't save ----
{
  let saves = 0
  const q = createSaveQueue({ save: async () => { saves++ } })
  await q.flush()
  ok(saves === 0 && !q.isDirty(), 'flush on a clean queue is a no-op')
}

// ---- happy path: dirty -> saving -> saved ----
{
  const states = []
  let saves = 0
  const q = createSaveQueue({ save: async () => { saves++ }, onState: (s) => states.push(s) })
  q.markDirty()
  ok(q.isDirty(), 'markDirty sets dirty')
  await q.flush()
  ok(saves === 1 && !q.isDirty(), 'flush runs the save once and clears dirty')
  ok(states.join() === 'saving,saved', 'state goes saving -> saved')
}

// ---- saves requested mid-flight coalesce into ONE trailing save ----
{
  let saves = 0
  let release
  const gate = new Promise((r) => { release = r })
  const q = createSaveQueue({ save: async () => { saves++; if (saves === 1) await gate } })
  q.markDirty()
  const first = q.flush() // starts save #1, holds on the gate
  q.markDirty(); q.flush() // requested mid-flight ...
  q.markDirty(); q.flush() // ... several times
  release()
  await first
  await tick(); await tick() // let the trailing save chain run
  ok(saves === 2, `mid-flight flushes coalesce into one trailing save (got ${saves})`)
  ok(!q.isDirty(), 'queue ends clean')
}

// ---- a failed save re-marks dirty and reports error; next flush retries ----
{
  const states = []
  let attempts = 0
  const q = createSaveQueue({
    save: async () => { attempts++; if (attempts === 1) throw new Error('boom') },
    onState: (s) => states.push(s),
  })
  q.markDirty()
  await q.flush()
  ok(q.isDirty(), 'failed save leaves the queue dirty (so it retries)')
  ok(states.join() === 'saving,error', 'failure reports the error state')
  await q.flush()
  ok(attempts === 2 && !q.isDirty(), 'next flush retries and succeeds')
  ok(states.join() === 'saving,error,saving,saved', 'retry reports saving -> saved')
}

// ---- error carries the Error object through to onState ----
{
  const errors = []
  const boom = new Error('network blip')
  const q = createSaveQueue({
    save: async () => { throw boom },
    onState: (s, err) => { if (s === 'error') errors.push(err) },
  })
  q.markDirty()
  await q.flush()
  ok(errors.length === 1 && errors[0] === boom, 'error object is passed as second arg to onState')
}

// ---- 409 conflict: queue is NOT re-marked dirty; no auto-retry ----
{
  const states = []
  let attempts = 0
  const conflict = new Error('conflict')
  conflict.status = 409
  const q = createSaveQueue({
    save: async () => { attempts++; throw conflict },
    onState: (s, err) => states.push({ s, status: err?.status }),
  })
  q.markDirty()
  await q.flush()
  ok(!q.isDirty(), '409 does NOT re-mark dirty (no auto-retry)')
  ok(states.length === 2 && states[1].s === 'error' && states[1].status === 409, '409 error surfaces to onState with status')
  // A second flush should be a no-op because dirty is false.
  await q.flush()
  ok(attempts === 1, '409 is never auto-retried — only one save attempt')
}

// ---- non-409 errors DO re-mark dirty ----
{
  let attempts = 0
  const netErr = new Error('gateway timeout')
  netErr.status = 502
  const q = createSaveQueue({
    save: async () => { attempts++; if (attempts < 3) throw netErr },
    onState: () => {},
  })
  q.markDirty()
  await q.flush()
  ok(q.isDirty(), '502 re-marks dirty for later retry')
  await q.flush()
  ok(q.isDirty(), 'still dirty after second 502')
  await q.flush()
  ok(!q.isDirty() && attempts === 3, 'succeeds on third attempt, no longer dirty')
}

// ---- reset forgets unsaved state ----
{
  let saves = 0
  const q = createSaveQueue({ save: async () => { saves++ } })
  q.markDirty()
  q.reset()
  await q.flush()
  ok(saves === 0 && !q.isDirty(), 'reset clears dirty so flush is a no-op')
}

console.log(`\nsavequeue.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
