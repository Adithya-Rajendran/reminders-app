import { Icon } from '../../icons.jsx'

// A clear TWO-STATE toggle for a task's explicit importance flag — the Eisenhower
// IMPORTANCE axis (task.important), kept separate from urgency (due date) and from
// the 0–5 priority. One flag, one button: pressed = important.
//
// State is conveyed by TEXT + ICON, never color alone (WCAG 1.4.1): the label
// always reads "Important", the star fills when on and is outline when off, and
// aria-pressed exposes the toggle state to assistive tech. A color-blind or
// grayscale user can still tell the two states apart by the star's fill.

// Star drawn from the shared Icon primitive so it inherits the set's stroke +
// sizing. `fill` flips between the accent (on) and none (off) — the outline path
// stays either way, so the shape is recognizable in both states.
function StarIcon({ filled, size = 14 }) {
  return (
    <Icon size={size} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.35 6.19 20.4 7.3 13.93 2.6 9.35l6.5-.95L12 2.5z" />
    </Icon>
  )
}

// value  boolean — is the task flagged important
// onSet(next)  called with the toggled boolean
export default function ImportanceControl({ value = false, onSet }) {
  const on = !!value
  return (
    <button
      type="button"
      className={`chip imp-chip${on ? ' on' : ' empty'}`}
      aria-pressed={on}
      title={on ? 'Important — click to unmark' : 'Mark as important'}
      onClick={() => onSet(!on)}
    >
      <StarIcon filled={on} />
      Important
    </button>
  )
}
