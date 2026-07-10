import { useRef, useState } from 'react'
import { IconChevDown, IconPlus, IconCheck } from '../icons.jsx'
import { AnchoredPopover } from './AnchoredPopover.jsx'

// Pick zero or more Contexts for a task (the "@errands / @calls / @deep-work"
// mode axis, orthogonal to the single Project/Area). Contexts are plain label
// titles, so the control is a multi-select checkbox menu with a type-to-filter /
// type-to-create box: the set is open-ended and grows as the user names new modes.
//
// Multi, not single: a task can be valid in more than one context (a call you can
// also make from your desk), and GTD's context filtering only works if you can tag
// every place a task fits. Selected contexts show as a count on the trigger chip.

// The panel: a filter/create box, then a checkbox row per option (checked ones
// first is deliberately NOT done — stable order avoids rows jumping under the
// cursor as you toggle). Enter creates the typed context if it's new.
function ContextPanel({ value, options, onToggle, onCreate }) {
  const [q, setQ] = useState('')
  const query = q.trim()
  const lower = query.toLowerCase()
  const matches = query ? options.filter((c) => c.toLowerCase().includes(lower)) : options
  const exists = options.some((c) => c.toLowerCase() === lower)
  const rows = matches

  const create = () => {
    if (!query || exists) return
    onCreate?.(query)
    setQ('')
  }

  return (
    <div className="gp-panel">
      <input
        className="input gp-search" autoFocus value={q}
        onChange={(e) => setQ(e.target.value)}
        // Enter is the fast path: if the typed text names a new context, create it;
        // otherwise toggle the top match. Arrow/Home/End roving into the checkbox
        // list is handled by useMenuKeyNav on the wrapping popover.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (query && !exists) create()
          else if (rows.length) onToggle(rows[0])
        }}
        placeholder="Filter or add context…" aria-label="Filter or add context"
      />
      <div className="gp-list" role="group" aria-label="Contexts">
        {rows.map((c) => {
          const on = value.includes(c)
          return (
            <button
              key={c} type="button" className={`gp-item${on ? ' on' : ''}`}
              role="menuitemcheckbox" aria-checked={on}
              onClick={() => onToggle(c)}
            >
              <span className="cp-check" aria-hidden="true">{on ? <IconCheck size={14} /> : null}</span> {c}
            </button>
          )
        })}
        {query && !matches.length && <div className="inline-empty start gp-empty">No matching context</div>}
        {!query && !options.length && <div className="inline-empty start gp-empty">No contexts yet — type to add one</div>}
        {query && !exists && onCreate && (
          <>
            <div className="gp-sep" />
            <button type="button" className="gp-item gp-new" role="menuitem" onClick={create}>
              <IconPlus size={14} /> Add “{query}”
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Module-level nav options for stable identity; focus starts in the search box,
// ArrowDown moves into the checkbox list.
const LIST_NAV = { selector: '.gp-item', initial: (el) => el.querySelector('.gp-search') }

// value  string[] of selected context titles
// options  string[] of all known context titles (live, from organizer.contexts())
// onSet(next)  called with the FULL next array on every toggle (add/remove)
// onCreate?(name)  optional — create a brand-new context by name (typed in the box)
export default function ContextPicker({ value = [], options = [], onSet, onCreate }) {
  const btnRef = useRef(null)
  const [open, setOpen] = useState(false)
  const count = value.length
  // Toggle emits the whole next array (onSet is a replace, not a delta) — the
  // caller patches task.labels wholesale, so a single source of truth is simpler
  // than reconciling add/remove events.
  const toggle = (c) => { onSet(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]) }
  // A newly created context is selected immediately — creating one you don't want
  // on the task would be surprising. The parent's onCreate persists it as a label.
  const create = (name) => {
    onCreate?.(name)
    if (!value.includes(name)) onSet([...value, name])
  }

  return (
    <span className="gp-wrap">
      <button
        type="button" ref={btnRef} className={`rem-group gp-trigger${count ? ' active' : ''}`}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={count ? 'gp-val' : 'gp-ph'}>
          {count === 0 ? 'Context' : count === 1 ? value[0] : `${count} contexts`}
        </span>
        <IconChevDown size={13} style={{ opacity: 0.7, flex: '0 0 auto' }} />
      </button>
      {open && (
        <AnchoredPopover anchorRef={btnRef} onClose={() => setOpen(false)} navOptions={LIST_NAV}>
          <ContextPanel value={value} options={options} onToggle={toggle} onCreate={onCreate ? create : undefined} />
        </AnchoredPopover>
      )}
    </span>
  )
}
