// Serialized, coalescing save queue (pure — node-tested in test/savequeue.test.mjs).
// At most one save() runs at a time; flushes requested mid-flight collapse into
// a single trailing save with the latest payload; a failed save re-marks the
// queue dirty so the next flush retries (except 409 — conflict needs a user
// decision, so we surface the error but do NOT re-mark dirty or auto-retry).
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
    catch (err) {
      // 409 = ETag conflict: the note changed on the server while we had it open.
      // Retrying automatically would silently overwrite the remote change, so we
      // leave dirty=false (no auto-retry) and pass the error to onState so the
      // editor can render a conflict banner.
      if (err?.status !== 409) dirty = true
      onState?.('error', err)
    }
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
