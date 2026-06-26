import { useEffect } from 'react'

// One document-level keydown for the app-wide command palette + quick-capture,
// mounted once in App. Following Obsidian: Ctrl/Cmd+O opens the note
// quick-switcher, Ctrl/Cmd+P (and Ctrl/Cmd+K as a friendlier alias) opens the
// command palette. A bare 'c' (Linear-style) opens global quick-capture — but
// ONLY when not typing into a field/editor, so it never hijacks text entry or
// Ctrl+C. Modifier combos preventDefault so the browser's Open/Print don't fire.
const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
export function useGlobalHotkeys({ onQuickSwitch, onCommands, onQuickCapture }) {
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      const k = (e.key || '').toLowerCase()
      // Bare 'c' = quick-capture from anywhere (no modifier), unless typing.
      if (!mod && !e.altKey && !e.shiftKey && k === 'c' && onQuickCapture && !isTyping(document.activeElement)) {
        e.preventDefault(); onQuickCapture(); return
      }
      if (!mod || e.altKey || e.shiftKey) return
      if (k === 'o') { e.preventDefault(); onQuickSwitch?.() }
      else if (k === 'p' || k === 'k') { e.preventDefault(); onCommands?.() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onQuickSwitch, onCommands, onQuickCapture])
}
