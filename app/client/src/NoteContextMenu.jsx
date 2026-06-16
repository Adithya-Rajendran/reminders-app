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
