import { useEffect, useState } from 'react'
import { notesApi } from './api.js'
import { emitOpenNote } from './notesbus.js'
import { IconLink, IconChevR } from './icons.jsx'

// "Linked mentions" panel: other notes that [[link]] to the open note. Reads the
// server link index (populated as notes are saved/listed). Hidden when empty.
export default function Backlinks({ path }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(true)
  useEffect(() => {
    if (!path) { setItems([]); return undefined }
    let alive = true
    notesApi.backlinks(path).then((r) => { if (alive) setItems(Array.isArray(r.backlinks) ? r.backlinks : []) }).catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [path])
  if (!items.length) return null
  return (
    <div className="backlinks">
      <button type="button" className="backlinks-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconChevR size={12} className={`tree-chev${open ? ' open' : ''}`} />
        <IconLink size={13} /> Linked mentions <span className="backlinks-count">{items.length}</span>
      </button>
      {open && (
        <div className="backlinks-list">
          {items.map((b) => (
            <button key={b.path} type="button" className="backlinks-item" onClick={() => emitOpenNote(b.path)} title={b.path}>
              <span className="backlinks-title">{b.title}</span>
              {b.context && <span className="backlinks-context">{b.context}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
