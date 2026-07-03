// The global "active organizer filter" — which Project/Area or Context the whole
// board is scoped to. An external store (like taskstore.js / boardbus.js) so every
// widget can react to a change via useSyncExternalStore while the `organizer`
// capability object stays a stable reference. `{ areaId, context }`; null = no
// filter on that axis. Pure module — framework-free, node-testable.
let filter = { areaId: null, context: null }
const subs = new Set()

export const getOrganizerFilter = () => filter

export function setOrganizerFilter(next) {
  const areaId = next?.areaId || null
  const context = next?.context || null
  if (areaId === filter.areaId && context === filter.context) return // no-op: don't churn subscribers
  filter = { areaId, context }
  for (const fn of subs) { try { fn() } catch { /* a dead subscriber must not break the rest */ } }
}

export function subscribeOrganizerFilter(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}
