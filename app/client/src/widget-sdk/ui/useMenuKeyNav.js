// Roving keyboard focus for the app's mini-menu popovers (priority menu,
// estimate chips, group picker, context menus): ArrowUp/Down wrap,
// Home/End jump, Left/Right alias Up/Down for radio rows, Enter/Space activate
// via the item's native click. Generalized from NoteContextMenu's inline model
// so every popover shares ONE implementation. Esc/outside-click dismissal and
// focus restoration stay in usePopover — this hook only moves focus while open.
//
// Contract: `ref` wraps the popover; items are queried live via `selector`
// (robust to conditionally rendered rows). `initial` optionally returns the
// element to focus on open (e.g. the checked radio); default = first item.
import { useEffect } from 'react'
import { nextIndex, claimsKey, normalizeKey } from '../../menukeys.js'

export function useMenuKeyNav(open, ref, { selector = '[role="menuitem"]', initial, radio = false } = {}) {
  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const items = () => Array.from(el.querySelectorAll(selector))
    const start = (initial && initial(el)) || items()[0]
    start?.focus()
    const onKey = (e) => {
      const list = items()
      if (!list.length) return
      const i = list.indexOf(document.activeElement)
      // Home/End typed in a text field OUTSIDE the item list (a search input
      // with content, e.g. the group picker) must keep their native caret
      // behavior; with the field empty they still jump the list.
      const a = document.activeElement
      if ((e.key === 'Home' || e.key === 'End') && i < 0 && a?.matches?.('input, textarea') && a.value) return
      if (claimsKey(e.key, { radio })) {
        e.preventDefault()
        list[nextIndex(normalizeKey(e.key), i, list.length)]?.focus()
      } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
        e.preventDefault()
        list[i].click()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [open, ref, selector, initial, radio])
}
