import { useEffect } from 'react'

// One document-level keydown for the app-wide command palette + quick-capture,
// mounted once in App. Following Obsidian: Ctrl/Cmd+O opens the note
// quick-switcher, Ctrl/Cmd+P (and Ctrl/Cmd+K as a friendlier alias) opens the
// command palette. A bare 'c' (Linear-style) opens global quick-capture, a bare
// '?' the shortcut cheat sheet — but ONLY when not typing into a field/editor,
// so they never hijack text entry or Ctrl+C. Ctrl/Cmd+[ / ] cycle dashboards
// (browser Back/Forward uses Cmd+arrow, so the brackets are safe to claim).
// Modifier combos preventDefault so the browser's Open/Print don't fire.
const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
export function useGlobalHotkeys({ onQuickSwitch, onCommands, onQuickCapture, onHelp, onCycleDash }) {
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      const k = (e.key || '').toLowerCase()
      // Bare 'c' = quick-capture from anywhere (no modifier), unless typing.
      if (!mod && !e.altKey && !e.shiftKey && k === 'c' && onQuickCapture && !isTyping(document.activeElement)) {
        e.preventDefault(); onQuickCapture(); return
      }
      // Bare '?' = shortcut cheat sheet. Shift is inherently held for '?', so
      // match on e.key and exempt the shift check.
      if (!mod && !e.altKey && e.key === '?' && onHelp && !isTyping(document.activeElement)) {
        e.preventDefault(); onHelp(); return
      }
      if (!mod || e.altKey || e.shiftKey) return
      if (k === 'o') { e.preventDefault(); onQuickSwitch?.() }
      else if (k === 'p' || k === 'k') { e.preventDefault(); onCommands?.() }
      else if (e.key === '[' || e.key === ']') { e.preventDefault(); onCycleDash?.(e.key === ']' ? 1 : -1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onQuickSwitch, onCommands, onQuickCapture, onHelp, onCycleDash])
}
