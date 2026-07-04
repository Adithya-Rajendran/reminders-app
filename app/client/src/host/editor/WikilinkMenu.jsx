import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { wikilinkBridge } from './Wikilink.js'

// Autocomplete popup for `[[` wikilinks: fuzzy note titles + a "Create" option.
// State + key events arrive via wikilinkBridge (same pattern as the slash menu).
export default function WikilinkMenu() {
  const [st, setSt] = useState({ open: false, items: [] })
  const [sel, setSel] = useState(0)
  const stRef = useRef(st), selRef = useRef(0)
  stRef.current = st
  selRef.current = sel

  useEffect(() => wikilinkBridge.subscribe((next) => { setSt(next); setSel(0) }), [])

  useEffect(() => {
    wikilinkBridge.setKeyHandler((e) => {
      const s = stRef.current
      if (!s.open || !s.items?.length) return false
      if (e.key === 'ArrowDown') { setSel((i) => (i + 1) % s.items.length); return true }
      if (e.key === 'ArrowUp') { setSel((i) => (i - 1 + s.items.length) % s.items.length); return true }
      if (e.key === 'Enter') { const it = s.items[selRef.current]; if (it) s.command(it); return true }
      if (e.key === 'Escape') { setSt({ open: false, items: [] }); return true }
      return false
    })
    return () => wikilinkBridge.setKeyHandler(null)
  }, [])

  useEffect(() => { document.querySelector('.slash-item.sel')?.scrollIntoView({ block: 'nearest' }) }, [sel, st])

  if (!st.open || !st.items?.length) return null
  const rect = st.clientRect?.()
  if (!rect) return null
  const pick = (i) => { const it = st.items[i]; if (it) st.command(it) }
  return createPortal(
    <div className="slash-menu" style={{ position: 'fixed', left: Math.round(rect.left), top: Math.round(rect.bottom + 6) }} role="listbox">
      {st.items.map((it, i) => (
        <button
          key={(it.create ? 'new:' : '') + it.title + ':' + i} type="button" role="option" aria-selected={i === sel}
          className={`slash-item${i === sel ? ' sel' : ''}`}
          onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); pick(i) }}
        >
          <span className="slash-item-title">{it.create ? `Create “${it.title}”` : it.title}</span>
          {it.create && <span className="slash-item-group">new</span>}
        </button>
      ))}
    </div>,
    document.body,
  )
}
