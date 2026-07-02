// Serialized, coalescing save queue (pure — node-tested in test/savequeue.test.mjs).
// At most one save() runs at a time; flushes requested mid-flight collapse into
// a single trailing save with the latest payload; a failed save re-marks the
// queue dirty so the next flush retries (except 409 — conflict needs a user
// decision, so we surface the error but do NOT re-mark dirty or auto-retry).
export function createSaveQueue({ save, onState }) {
  let inFlight = false
  let pending = false
  let dirty = false
  // Resolves when the queue is fully quiescent — the in-flight PUT *and* any
  // trailing coalesced save have settled (onState already fired for them).
  // flush() always returns it, so a caller that must not proceed past unsaved
  // data (editor close) can genuinely wait. The old flush() returned early
  // while a save was mid-air — a silent-data-loss hole on close.
  let settled = Promise.resolve()
  let resolveSettled = null

  const run = async () => {
    inFlight = true
    if (!resolveSettled) settled = new Promise((r) => { resolveSettled = r })
    dirty = false
    onState?.('saving')
    try { await save(); onState?.('saved') }
    catch (err) {
      // 409 = ETag conflict: the note changed on the server while we had it open.
      // Retrying automatically would silently overwrite the remote change, so we
      // leave dirty=false (no auto-retry) and pass the error to onState so the
      // editor can render a conflict banner.
      if (err?.status !== 409) dirty = true
      onState?.('error', err)
    } finally {
      inFlight = false
      if (pending) { pending = false; if (dirty) run() }
      // Quiescent only if the line above didn't chain a trailing run.
      if (!inFlight) { const r = resolveSettled; resolveSettled = null; r?.() }
    }
  }

  const flush = () => {
    if (inFlight) pending = true
    else if (dirty) run()
    return settled
  }

  return {
    markDirty: () => { dirty = true },
    isDirty: () => dirty,
    // Forget unsaved state (e.g. a fresh note was loaded over the editor).
    reset: () => { dirty = false; pending = false },
    flush,
  }
}
