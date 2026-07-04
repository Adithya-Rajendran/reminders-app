import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMenuKeyNav } from './useMenuKeyNav.js'

// Portal popover anchored under a trigger (flips above if there's no room), so a
// small/scrolling widget never clips it. Handles placement (+ reposition on
// scroll/resize), outside-click / Esc dismissal, focus-restore to the trigger on
// close, and roving keyboard nav over its items. Shared by the Area / Context / Group
// pickers — they differ only in PANEL content plus a few knobs (min width, the
// roving-nav options, and an optional listbox role), passed as props.
//
// `navOptions` MUST be a stable (module-level) object: useMenuKeyNav keys its effect
// on it, so a per-render object would re-focus `initial` mid-navigation.
export function AnchoredPopover({ anchorRef, onClose, navOptions, minWidth = 220, heightFallback = 320, role, ariaLabel, children }) {
  const popRef = useRef(null)
  const [pos, setPos] = useState(null)
  // `!!pos`, not `true`: the pop renders null until placed, so keying the hook on
  // placement runs its focus effect only once the panel actually exists in the DOM.
  useMenuKeyNav(!!pos, popRef, navOptions)
  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    const W = Math.max(minWidth, r.width)
    // On the FIRST placement `pos` is null so the portal isn't mounted yet and
    // popRef has no height — `heightFallback` is the assumed height that decides
    // flip-above on that first paint (re-measured on the next scroll/resize). Each
    // picker keeps its original guess so this stays a behaviour-preserving default.
    const H = popRef.current?.offsetHeight || heightFallback
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
    let top = r.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 6)
    setPos({ top, left, width: W })
  }, [anchorRef, minWidth, heightFallback])
  useLayoutEffect(() => { place() }, [place])
  useEffect(() => {
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [place])
  useEffect(() => {
    // Capture the element that had focus when this popover mounted (the trigger). On
    // cleanup, restore focus there if it's orphaned (Esc / picking an item) — keyboard
    // users aren't dumped to <body>. Same orphan-check idiom as usePopover.js: if the
    // user clicked another control, leave focus there.
    const prevFocus = document.activeElement
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      const active = document.activeElement
      const orphaned = !active || active === document.body || (popRef.current && popRef.current.contains(active))
      if (orphaned && prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus()
    }
  }, [anchorRef, onClose])
  if (!pos) return null
  return createPortal(
    <div ref={popRef} className="gp-pop menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }} role={role} aria-label={ariaLabel}>{children}</div>,
    document.body,
  )
}
