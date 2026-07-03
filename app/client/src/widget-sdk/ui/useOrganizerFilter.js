import { useSyncExternalStore } from 'react'

// Subscribe a widget to the global active organizer filter ({ areaId?, context? })
// delivered through its `organizer` ctx capability, so scoping the board to a
// Project/Area or Context happens ONCE (in the palette or the board filter bar) and
// every task widget reacts. Returns the current filter, or null when the widget
// didn't plug `organizer` (a board could omit it). Pair with applyOrganizer(tasks,
// filter). Kept in the SDK so widgets never import the organizer store directly
// (the widget-boundary rule) — the capability arrives through ctx like every other.
const NOOP_SUBSCRIBE = () => () => {}
const NULL_FILTER = () => null

export function useOrganizerFilter(organizer) {
  const subscribe = organizer?.subscribe || NOOP_SUBSCRIBE
  const getFilter = organizer?.getFilter || NULL_FILTER
  return useSyncExternalStore(subscribe, getFilter, getFilter)
}
