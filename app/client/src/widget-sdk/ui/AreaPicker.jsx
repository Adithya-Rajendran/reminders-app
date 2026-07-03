import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconChevDown, IconX } from '../../icons.jsx'
import { useMenuKeyNav } from './useMenuKeyNav.js'

// A compact control to assign a task's Project/Area — one pick, or "No project/
// area" to clear. Styled like GroupPicker (same .gp-* surface), but the menu is
// GROUPED by kind (Projects then Areas) rather than searchable: the area set is
// small and hand-curated, so a flat grouped list reads faster than a search box.
//
// Areas are the single-select "where does this belong" axis; Contexts (a separate
// multi-select control) are the "what mode am I in" axis. Keeping them as distinct
// controls mirrors the data model (task.area is one id; contexts are labels).

// Portal popover anchored under the trigger (flips above if there's no room), so a
// small/scrolling widget never clips it. Same placement + focus-restore idiom as
// GroupPicker's GroupPop — kept local rather than shared because the panels differ.
// Module-level nav options so the object identity is stable (the hook keys its
// effect on it; a per-render object would re-focus `initial` mid-navigation).
const LIST_NAV = { selector: '.gp-item' }

function AreaPop({ anchorRef, onClose, children }) {
  const popRef = useRef(null)
  const [pos, setPos] = useState(null)
  // `!!pos`, not `true`: the pop renders null until placed, so keying the hook on
  // placement runs its focus effect only once the panel exists in the DOM.
  useMenuKeyNav(!!pos, popRef, LIST_NAV)
  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    const W = Math.max(200, r.width)
    const H = popRef.current?.offsetHeight || 300
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
    // Restore focus to the trigger on close if it would otherwise be orphaned
    // (Esc / picking an item) — keyboard users aren't dumped to <body>. Same
    // orphan-check as usePopover: if the user clicked another control, leave it.
    const prevFocus = document.activeElement
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      const active = document.activeElement
      const orphaned = !active || active === document.body || (popRef.current && popRef.current.contains(active))
      if (orphaned && prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus()
    }
  }, [anchorRef, onClose])
  if (!pos) return null
  return createPortal(
    <div ref={popRef} className="gp-pop menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }} role="listbox" aria-label="Project or area">{children}</div>,
    document.body,
  )
}

// A colored dot echoing the area's own color, so the menu rows and the active
// trigger read as the same entity the user picked. Falls back to the accent.
function AreaDot({ color }) {
  return <span className="pdot" style={{ background: color || 'var(--accent)', width: 9, height: 9, flex: '0 0 auto' }} />
}

// value  the selected area id, or '' for none
// areas  [{ id, name, kind:'project'|'area', color }] — grouped by kind in the menu
// onSet(id)  called with the picked id, or '' to clear
export default function AreaPicker({ value = '', areas = [], onSet }) {
  const btnRef = useRef(null)
  const [open, setOpen] = useState(false)
  const active = areas.find((a) => a.id === value) || null
  // Re-picking the active row toggles it off (clears) — same reversible-from-menu
  // affordance GroupPicker gives, so a mis-pick doesn't strand the task.
  const pick = (id) => { onSet(id === value ? '' : id); setOpen(false) }
  const projects = areas.filter((a) => a.kind === 'project')
  const otherAreas = areas.filter((a) => a.kind === 'area')

  const renderGroup = (label, list) => (
    list.length ? (
      <>
        <div className="gp-sec">{label}</div>
        {list.map((a) => (
          <button key={a.id} type="button" className={`gp-item${a.id === value ? ' on' : ''}`} role="option" aria-selected={a.id === value} onClick={() => pick(a.id)}>
            <AreaDot color={a.color} /> {a.name}
          </button>
        ))}
      </>
    ) : null
  )

  return (
    <span className="gp-wrap">
      <button
        type="button" ref={btnRef} className={`rem-group gp-trigger${active ? ' active' : ''}`}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={active ? 'gp-val' : 'gp-ph'}>{active ? active.name : 'Project / area'}</span>
        <IconChevDown size={13} style={{ opacity: 0.7, flex: '0 0 auto' }} />
      </button>
      {active ? (
        // A sibling clear button (not nested — nested buttons are invalid HTML and
        // unreachable for AT), so a one-click reset never requires re-opening the menu.
        <button type="button" className="iconbtn sm gp-clear" aria-label="Clear project or area" title="Clear project or area" onClick={() => onSet('')}>
          <IconX size={12} />
        </button>
      ) : null}
      {open && (
        <AreaPop anchorRef={btnRef} onClose={() => setOpen(false)}>
          <div className="gp-panel">
            <div className="gp-list">
              <button type="button" className={`gp-item${!value ? ' on' : ''}`} role="option" aria-selected={!value} onClick={() => pick('')}>
                <span className="gp-dot-sp" /> No project/area
              </button>
              {renderGroup('Projects', projects)}
              {renderGroup('Areas', otherAreas)}
              {!areas.length && <div className="gp-empty">No projects or areas yet</div>}
            </div>
          </div>
        </AreaPop>
      )}
    </span>
  )
}
