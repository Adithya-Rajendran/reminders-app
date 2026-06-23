import { useEffect, useRef } from 'react'

// Close an open popover on outside-click or Esc. Returns the ref to put on the
// popover's positioning container (clicks inside it don't close it).
export function usePopover(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    // Remember what had focus when the popover opened (usually the trigger), so
    // we can hand focus back on close — keyboard users aren't dumped to <body>.
    const prevFocus = document.activeElement
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      // Only restore if focus would otherwise be orphaned (Esc / selecting an
      // item inside). If the user clicked another control, leave focus there.
      const active = document.activeElement
      const orphaned = !active || active === document.body || (ref.current && ref.current.contains(active))
      if (orphaned && prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus()
    }
  }, [open, setOpen])
  return ref
}
