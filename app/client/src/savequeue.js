// Serialized, coalescing save queue (pure — node-tested in test/savequeue.test.mjs).
// At most one save() runs at a time; flushes requested mid-flight collapse into
// a single trailing save with the latest payload; a failed save re-marks the
// queue dirty so the next flush retries.
export function createSaveQueue({ save, onState }) {
  let inFlight = false
  let pending = false
  let dirty = false

  const flush = async () => {
    if (inFlight) { pending = true; return }
    if (!dirty) return
    inFlight = true
    dirty = false
    onState?.('saving')
    try { await save(); onState?.('saved') }
    catch { dirty = true; onState?.('error') }
    finally { inFlight = false; if (pending) { pending = false; flush() } }
  }

  return {
    markDirty: () => { dirty = true },
    isDirty: () => dirty,
    // Forget unsaved state (e.g. a fresh note was loaded over the editor).
    reset: () => { dirty = false; pending = false },
    flush,
  }
}
