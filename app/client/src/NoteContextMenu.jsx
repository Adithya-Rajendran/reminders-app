import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCopy, IconPin, IconTrash, IconNote } from './icons.jsx'

// Right-click / ⋯ menu for a note row. Positioned at (x, y) and clamped to the
// viewport; closes on outside-click or Esc. The widget owns the actions.
export default function NoteContextMenu({ note, x, y, onClose, onRename, onDuplicate, onPin, onDelete }) {
  const ref = useRef(null)
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  // Move focus into the menu on open (the menu is keyboard-reachable from the
  // ⋯ button / right-click) and run a roving-focus model over the menuitems:
  // Arrow keys + Home/End move focus; Enter/Space activate via the button's
  // native click. Querying the live DOM keeps this robust to the items rendered.
  useEffect(() => {
    const items = () => Array.from(ref.current?.querySelectorAll('[role="menuitem"]') || [])
    items()[0]?.focus()
    const onKey = (e) => {
      const list = items()
      if (!list.length) return
      const i = list.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1 + list.length) % list.length]?.focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
      else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); list[i].click() }
    }
    const el = ref.current
    el?.addEventListener('keydown', onKey)
    return () => el?.removeEventListener('keydown', onKey)
  }, [])
  const style = {
    position: 'fixed', zIndex: 90,
    left: Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 210),
    top: Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 190),
  }
  const run = (fn) => { fn(); onClose() }
  return createPortal(
    <div className="menu note-ctx-menu" ref={ref} role="menu" style={style}>
      <div className="menu-label note-ctx-title"><IconNote size={13} /> {note.title}</div>
      <button type="button" className="menu-item" role="menuitem" onClick={() => run(onRename)}>Rename…</button>
      <button type="button" className="menu-item" role="menuitem" onClick={() => run(onDuplicate)}><IconCopy size={15} /> Duplicate</button>
      <button type="button" className="menu-item" role="menuitem" onClick={() => run(onPin)}><IconPin size={15} /> {note.pinned ? 'Unpin' : 'Pin to top'}</button>
      <div className="menu-sep" />
      <button type="button" className="menu-item" role="menuitem" style={{ color: 'var(--danger)' }} onClick={() => run(onDelete)}><IconTrash size={15} /> Move to Trash</button>
    </div>,
    document.body,
  )
}
