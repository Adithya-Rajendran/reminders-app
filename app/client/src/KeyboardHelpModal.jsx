import ModalFrame from './ModalFrame.jsx'
import { useModalRef } from './useModalRef.js'
import { IconX } from './icons.jsx'

// The '?' cheat sheet — every global hotkey in one glanceable card, so the
// keyboard spine is discoverable without reading docs. Also reachable from the
// command palette ("Keyboard shortcuts"), so each surface advertises the other.
const GLOBAL = [
  ['c', 'Capture a task from anywhere'],
  ['n', 'New note'],
  ['Ctrl/⌘ K', 'Command palette (or Ctrl/⌘ P)'],
  ['Ctrl/⌘ O', 'Search notes'],
  ['Ctrl/⌘ [ · ]', 'Previous / next dashboard'],
  ['?', 'This cheat sheet'],
]
const PALETTE = [
  ['>', 'Switch to command mode'],
  ['↑ ↓', 'Navigate results'],
  ['PgUp PgDn', 'Jump by page (Home/End when empty)'],
  ['Enter', 'Open / run'],
  ['Esc', 'Close'],
]

function Section({ title, rows }) {
  return (
    <div className="kbd-help-col">
      <div className="kbd-help-title">{title}</div>
      {rows.map(([keys, what]) => (
        <div className="kbd-help-row" key={keys}>
          <span className="kbd-help-keys">{keys.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
          <span className="kbd-help-what">{what}</span>
        </div>
      ))}
    </div>
  )
}

export default function KeyboardHelpModal({ onClose }) {
  const ref = useModalRef(onClose)
  return (
    <ModalFrame modalClass="modal" ariaLabel="Keyboard shortcuts" onBackdrop={onClose}>
      <div ref={ref} style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close"><IconX /></button>
        </div>
        <div className="modal-body kbd-help">
          <Section title="Anywhere" rows={GLOBAL} />
          <Section title="In the palette" rows={PALETTE} />
        </div>
      </div>
    </ModalFrame>
  )
}
