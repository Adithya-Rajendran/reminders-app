import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconPlus, IconChevDown } from '../../icons.jsx'

// The panel content: a search box, the recent groups (or search matches), and a
// "New group…" row that routes to Settings (group creation lives there now).
// Reused both inside the add-widget menu and inside the GroupPicker popover.
//   neutral = { label, value, icon? } — the "No group" / "All groups" row.
export function GroupList({ groups = [], recent = [], value, onPick, onNew, neutral }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const matches = query ? groups.filter((g) => g.toLowerCase().includes(query)) : []
  const exact = query && groups.some((g) => g.toLowerCase() === query)
  const NIcon = neutral?.icon
  const rows = query ? matches : recent

  return (
    <div className="gp-panel">
      <input
        className="input gp-search" autoFocus value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search groups…" aria-label="Search groups"
      />
      <div className="gp-list" role="listbox">
        {!query && neutral && (
          <button type="button" className={`gp-item${value === neutral.value ? ' on' : ''}`} role="option" onClick={() => onPick(neutral.value)}>
            {NIcon ? <NIcon size={14} /> : <span className="gp-dot-sp" />} {neutral.label}
          </button>
        )}
        {!query && recent.length > 0 && <div className="gp-sec">Recent</div>}
        {rows.map((g) => (
          <button key={g} type="button" className={`gp-item${value === g ? ' on' : ''}`} role="option" onClick={() => onPick(g)}>
            <span className="pdot" style={{ background: 'var(--accent)', width: 9, height: 9 }} /> {g}
          </button>
        ))}
        {query && !matches.length && <div className="gp-empty">No matching group</div>}
        {!query && !recent.length && <div className="gp-empty">No recent groups — search or create one</div>}
        <div className="gp-sep" />
        <button type="button" className="gp-item gp-new" role="option" onClick={() => onNew(q.trim())}>
          <IconPlus size={14} /> New group{query && !exact ? ` “${q.trim()}”` : '…'}
        </button>
      </div>
    </div>
  )
}

// Portal popover anchored to a trigger (below, flipped above if no room), so it is
// never clipped by a small/scrolling widget. Dismisses on outside-click / Esc.
function GroupPop({ anchorRef, onClose, children }) {
  const popRef = useRef(null)
  const [pos, setPos] = useState(null)
  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    const W = Math.max(220, r.width)
    const H = popRef.current?.offsetHeight || 320
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
    let top = r.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6)
    setPos({ top, left, width: W })
  }, [anchorRef])
  useLayoutEffect(() => { place() }, [place])
  useEffect(() => {
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [place])
  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [anchorRef, onClose])
  if (!pos) return null
  return createPortal(
    <div ref={popRef} className="gp-pop menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}>{children}</div>,
    document.body,
  )
}

// A searchable group dropdown: the last-3 used groups by default, a search box to
// find any group, and "New group…" → Settings (no inline group creation).
export default function GroupPicker({ value, groups = [], recent = [], onChange, onNew, neutral, placeholder = 'Group' }) {
  const btnRef = useRef(null)
  const [open, setOpen] = useState(false)
  const pick = (v) => { onChange(v); setOpen(false) }
  const handleNew = (name) => { setOpen(false); onNew?.(name) }
  return (
    <>
      <button
        type="button" ref={btnRef} className="rem-group gp-trigger"
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? 'gp-val' : 'gp-ph'}>{value || placeholder}</span>
        <IconChevDown size={13} style={{ opacity: 0.7, flex: '0 0 auto' }} />
      </button>
      {open && (
        <GroupPop anchorRef={btnRef} onClose={() => setOpen(false)}>
          <GroupList groups={groups} recent={recent} value={value} onPick={pick} onNew={handleNew} neutral={neutral} />
        </GroupPop>
      )}
    </>
  )
}
