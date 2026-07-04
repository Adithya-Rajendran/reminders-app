import { useRef, useState } from 'react'
import { IconPlus, IconChevDown, IconX } from '../../icons.jsx'
import { AnchoredPopover } from './AnchoredPopover.jsx'

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
        // Enter is the fast path for "type a few letters, pick the top hit" — it
        // picks the first visible row. Arrow/Home/End roving into the option list
        // is handled by useMenuKeyNav in the AnchoredPopover that wraps this panel.
        onKeyDown={(e) => { if (e.key === 'Enter' && rows.length) { e.preventDefault(); onPick(rows[0]) } }}
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

// Keyboard: focus starts in the search box (typing filters), ArrowDown moves into
// the option list. Module-level options so the object identity is stable — the hook's
// effect keys on it, and a per-render object would re-focus `initial`.
const LIST_NAV = { selector: '.gp-item', initial: (el) => el.querySelector('.gp-search') }

// A searchable group dropdown: the last-3 used groups by default, a search box to
// find any group, and "New group…" → Settings (no inline group creation).
//
// An ACTIVE pick must be visible and reversible from the trigger itself — the
// bare group name used to read as a static label, with no route back to
// "no group" short of knowing to re-open the menu. So: a "Group:" prefix +
// active styling on the trigger, re-picking the active row toggles it off,
// and a one-click ✕ clears it (a sibling, not nested — nested buttons are
// invalid HTML and unreachable for AT).
export default function GroupPicker({ value, groups = [], recent = [], onChange, onNew, neutral, placeholder = 'Group' }) {
  const btnRef = useRef(null)
  const [open, setOpen] = useState(false)
  const cleared = neutral ? neutral.value : ''
  const pick = (v) => { onChange(v === value ? cleared : v); setOpen(false) }
  const handleNew = (name) => { setOpen(false); onNew?.(name) }
  return (
    <span className="gp-wrap">
      <button
        type="button" ref={btnRef} className={`rem-group gp-trigger${value ? ' active' : ''}`}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? 'gp-val' : 'gp-ph'}>{value ? `Group: ${value}` : placeholder}</span>
        <IconChevDown size={13} style={{ opacity: 0.7, flex: '0 0 auto' }} />
      </button>
      {value ? (
        <button type="button" className="iconbtn sm gp-clear" aria-label="Clear group" title="Clear group" onClick={() => onChange(cleared)}>
          <IconX size={12} />
        </button>
      ) : null}
      {open && (
        <AnchoredPopover anchorRef={btnRef} onClose={() => setOpen(false)} navOptions={LIST_NAV}>
          <GroupList groups={groups} recent={recent} value={value} onPick={pick} onNew={handleNew} neutral={neutral} />
        </AnchoredPopover>
      )}
    </span>
  )
}
