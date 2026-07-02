import { useState } from 'react'
import { usePopover } from '../../usePopover.js'

// Graded "dread" (avoidance) control — a compact chip that opens a 1–5 dot picker,
// styled like the other inline task controls (priority / estimate). Dread weights
// frog selection (a dreaded-but-important task becomes the day's frog) and the XP
// model (avoid-it-most work is worth the most), the evidence-honest nudge against
// quietly defaulting to easier work (KC & Staats 2020). Click the active level to
// clear back to 0. Shared via the widget-sdk so TaskRow and the Triage widget use
// one implementation.
const LEVELS = [1, 2, 3, 4, 5]

export default function DreadControl({ value = 0, onSet }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  const v = Math.max(0, Math.min(5, Math.trunc(Number(value) || 0)))
  return (
    <span className="inline-ctl" ref={ref}>
      <button
        type="button"
        className={`chip dread-chip${v ? ' on' : ' empty'}`}
        title="Dread: how much you want to avoid this. A dreaded, important task becomes today’s frog."
        aria-label={v ? `Dread ${v} of 5` : ‘Set dread’}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {v ? `dread ${v}` : 'dread'}
      </button>
      {open && (
        <div className="mini-menu dread-menu" role="radiogroup" aria-label="Dread level">
          <span className="dread-dots">
            {LEVELS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === v}
                className={`dread-dot${n <= v ? ' on' : ''}`}
                aria-label={`Dread ${n}`}
                onClick={() => { onSet(n === v ? 0 : n); setOpen(false) }}
              />
            ))}
          </span>
          {v > 0 && <button type="button" className="mini-item dread-clear" onClick={() => { onSet(0); setOpen(false) }}>Clear</button>}
        </div>
      )}
    </span>
  )
}
