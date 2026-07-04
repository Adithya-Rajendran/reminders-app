import { useEffect, useRef } from 'react'

// Modal focus management: focus the first focusable on open, trap Tab inside,
// close on Esc, restore focus on unmount. Put the returned ref on the dialog.
// Pass { autoFocus: false } when the dialog has its own autoFocus target (e.g.
// a form's first input) so we don't steal focus onto an earlier control.
export function useModalRef(onClose, opts = {}) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const prevFocus = document.activeElement
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusables = () => Array.from(node.querySelectorAll(sel)).filter((el) => !el.disabled && el.offsetParent !== null)
    const t = opts.autoFocus === false ? null : setTimeout(() => { const f = focusables(); (f[0] || node).focus() }, 30)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return }
      if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (prevFocus && prevFocus.focus) prevFocus.focus()
    }
  }, [])
  return ref
}
