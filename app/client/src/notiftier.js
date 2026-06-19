// Pure mapping of a reminder/overdue SSE event to an interruption TIER, so the UI
// can let genuinely urgent items break through while routine ones are shown quietly
// (or batched) rather than each interrupting. Push interrupts measurably raise
// stress and lower productivity; user-pull beats push (Mark et al., CHI 2016) —
// so the default leans quiet. No React/DOM/network imports -> node-testable.

export const TIERS = { BREAKTHROUGH: 'breakthrough', ROUTINE: 'routine' }

// Accepts the SSE envelope shape the app delivers ({ receivedAt, data:{ event:
// { event_name, data:{ task } } } }) and also a bare event, defensively.
function eventOf(envelope) {
  return envelope?.data?.event || envelope?.event || envelope || {}
}

// 'breakthrough' for an overdue alert or a high-priority (>=4) reminder; otherwise
// 'routine'. Kept deliberately simple and explicit so the threshold is auditable.
export function eventTier(envelope) {
  const ev = eventOf(envelope)
  const name = String(ev?.event_name || '').toLowerCase()
  const priority = Number(ev?.data?.task?.priority) || 0
  if (/overdue/.test(name)) return TIERS.BREAKTHROUGH
  if (priority >= 4) return TIERS.BREAKTHROUGH
  return TIERS.ROUTINE
}

// Split a list of events into the two tiers (order preserved within each).
export function partitionByTier(events) {
  const breakthrough = [], routine = []
  for (const e of (events || [])) (eventTier(e) === TIERS.BREAKTHROUGH ? breakthrough : routine).push(e)
  return { breakthrough, routine }
}
