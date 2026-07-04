import { IconList, IconX } from '../widget-sdk/icons.jsx'

// Table-of-contents rail for the open note. `items` come from extractOutline(body)
// and are in document order, so onPick(i) maps to the Nth heading in the editor.
export default function Outline({ items, onPick, onClose }) {
  return (
    <aside className="note-outline">
      <div className="note-outline-head">
        <IconList size={13} /> <span>Outline</span>
        <button type="button" className="note-outline-x" onClick={onClose} aria-label="Close outline"><IconX size={13} /></button>
      </div>
      {items.length === 0
        ? <div className="note-outline-empty">No headings yet.</div>
        : (
          <div className="note-outline-list">
            {items.map((h, i) => (
              <button key={i} type="button" className={`note-outline-item lvl-${h.level}`} style={{ paddingLeft: 8 + (h.level - 1) * 12 }} onClick={() => onPick(i)} title={h.text}>
                {h.text}
              </button>
            ))}
          </div>
        )}
    </aside>
  )
}
