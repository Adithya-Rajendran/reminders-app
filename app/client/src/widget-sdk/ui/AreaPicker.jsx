import { useRef, useState } from 'react'
import { IconChevDown, IconX } from '../../icons.jsx'
import { AnchoredPopover } from './AnchoredPopover.jsx'

// A compact control to assign a task's Project/Area — one pick, or "No project/
// area" to clear. Styled like GroupPicker (same .gp-* surface), but the menu is
// GROUPED by kind (Projects then Areas) rather than searchable: the area set is
// small and hand-curated, so a flat grouped list reads faster than a search box.
//
// Areas are the single-select "where does this belong" axis; Contexts (a separate
// multi-select control) are the "what mode am I in" axis. Keeping them as distinct
// controls mirrors the data model (task.area is one id; contexts are labels).

// Module-level nav options so the object identity is stable (useMenuKeyNav keys its
// effect on it). No `initial` — the grouped list has no search box to focus first,
// so roving starts on the first row.
const LIST_NAV = { selector: '.gp-item' }

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
        <AnchoredPopover anchorRef={btnRef} onClose={() => setOpen(false)} navOptions={LIST_NAV} minWidth={200} role="listbox" ariaLabel="Project or area">
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
        </AnchoredPopover>
      )}
    </span>
  )
}
