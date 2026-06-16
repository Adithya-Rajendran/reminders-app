import { useEffect } from 'react'

// One document-level keydown for the app-wide command palette, mounted once in
// App. Following Obsidian: Ctrl/Cmd+O opens the note quick-switcher, Ctrl/Cmd+P
// (and Ctrl/Cmd+K as a friendlier alias) opens the command palette. We
// preventDefault so the browser's own Open/Print don't fire. Only modifier
// combos are intercepted, so plain typing in inputs/the editor is untouched.
export function useGlobalHotkeys({ onQuickSwitch, onCommands }) {
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey || e.shiftKey) return
      const k = (e.key || '').toLowerCase()
      if (k === 'o') { e.preventDefault(); onQuickSwitch?.() }
      else if (k === 'p' || k === 'k') { e.preventDefault(); onCommands?.() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onQuickSwitch, onCommands])
}
