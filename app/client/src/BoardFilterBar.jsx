import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconList, IconX } from './icons.jsx'

// The active-filter strip: when the board is scoped to an Area/Context (from the
// omnibox or a widget), show what it's scoped to with a one-click Clear, so a
// filtered board is never a silent dead-end ("where did my other tasks go?").
// Renders nothing when there's no active filter. Shared by the desktop grid and the
// mobile shell — both scope the same global organizer filter.
export function BoardFilterBar({ organizer }) {
  const filter = useSyncExternalStore(organizer.subscribe, organizer.getFilter, organizer.getFilter)
  const [areas, setAreas] = useState([])
  const active = !!(filter && (filter.areaId || filter.context))
  useEffect(() => {
    if (!filter?.areaId) return undefined
    let alive = true
    organizer.areas().then((a) => { if (alive) setAreas(Array.isArray(a) ? a : []) }).catch(() => {})
    return () => { alive = false }
  }, [organizer, filter?.areaId])
  if (!active) return null
  const area = filter.areaId ? areas.find((a) => a.id === filter.areaId) : null
  const label = filter.areaId ? (area?.name || 'Area') : ('@' + filter.context)
  const kind = filter.areaId ? (area?.kind === 'project' ? 'Project' : 'Area') : 'Context'
  return (
    <div className="board-filter" role="status" aria-live="polite">
      <IconList size={13} className="board-filter-ic" />
      <span className="board-filter-label">Filtered to <b>{label}</b></span>
      <span className="board-filter-kind">{kind}</span>
      <button
        className="board-filter-clear"
        onClick={() => organizer.setFilter({ areaId: null, context: null })}
        aria-label={`Clear the ${label} filter — show all tasks`}
      >
        <IconX size={13} /> Clear
      </button>
    </div>
  )
}
