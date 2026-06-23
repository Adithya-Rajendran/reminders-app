import { useEffect, useMemo, useRef, useState } from 'react'
import ModalFrame from './ModalFrame.jsx'
import { useModalRef } from './useModalRef.js'
import { notesApi } from './api.js'
import { emitOpenNote } from './notesbus.js'
import { fuzzyRank } from './fuzzy.js'
import { IconSearch, IconNote, IconPlus, IconFolder, IconCornerDownLeft, IconSpinner } from './icons.jsx'

// Render a label with its fuzzy-matched characters emphasised. Groups runs so
// the DOM stays small for short note titles.
function Highlight({ text, positions }) {
  const set = positions && positions.length ? new Set(positions) : null
  if (!set) return text
  const arr = Array.from(text)
  const segs = []
  let buf = '', hit = false, seg = 0
  const flush = () => { if (buf) { segs.push(hit ? <b key={seg++} className="cmdk-hl">{buf}</b> : <span key={seg++}>{buf}</span>); buf = '' } }
  for (let i = 0; i < arr.length; i++) {
    const h = set.has(i)
    if (i > 0 && h !== hit) flush()
    buf += arr[i]; hit = h
  }
  flush()
  return segs
}

// App-wide command palette / quick-switcher (Obsidian Ctrl+O / Ctrl+P). Notes
// mode fuzzy-jumps to any note; typing `>` switches to command mode. Fully
// keyboard-driven; selecting a note emits on the notesbus so the widget opens it.
export default function CommandPalette({ initialMode = 'notes', commands = [], onClose }) {
  const [raw, setRaw] = useState(initialMode === 'commands' ? '>' : '')
  const [notes, setNotes] = useState(null) // null = loading | [] | [...]
  const [unconfigured, setUnconfigured] = useState(false)
  const [sel, setSel] = useState(0)
  const listRef = useRef(null)
  const ref = useModalRef(onClose)

  const cmdMode = raw.startsWith('>')
  const term = (cmdMode ? raw.slice(1) : raw).trim()

  // Load the note list once on open (cheap; the server caches it for 15s).
  useEffect(() => {
    let alive = true
    notesApi.list().then((r) => {
      if (!alive) return
      if (!r.configured) { setNotes([]); setUnconfigured(true); return }
      const list = (r.notes || []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
      setNotes(list)
    }).catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [])

  // Built-in note command + any app-level commands the host passes in (settings,
  // theme, dashboards, …) — so Ctrl/Cmd+K is a single keyboard-driven action spine.
  const COMMANDS = useMemo(() => [
    { id: 'new-note', label: 'New note', hint: 'Create a note in Notes', icon: IconPlus, run: async () => { try { const n = await notesApi.create('', 'Untitled'); emitOpenNote(n.path) } catch { /* ignore */ } } },
    ...commands,
  ], [commands])

  const results = useMemo(
    () => (cmdMode ? fuzzyRank(term, COMMANDS, (c) => c.label) : fuzzyRank(term, notes || [], (n) => n.title)),
    [cmdMode, term, notes, COMMANDS],
  )

  useEffect(() => { setSel(0) }, [cmdMode, term])
  useEffect(() => { if (sel >= results.length) setSel(Math.max(0, results.length - 1)) }, [results.length, sel])
  useEffect(() => { listRef.current?.querySelector('.cmdk-row.sel')?.scrollIntoView({ block: 'nearest' }) }, [sel, results])

  const activate = (i = sel) => {
    const r = results[i]; if (!r) return
    if (cmdMode) { r.item.run?.(); onClose() } else { emitOpenNote(r.item.path); onClose() }
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (results.length ? (s + 1) % results.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); activate() }
  }

  const loading = notes === null && !cmdMode

  return (
    <ModalFrame overlayClass="cmdk-overlay" modalClass="cmdk" ariaLabel="Command palette" onBackdrop={onClose}>
      <div ref={ref} className="cmdk-inner">
        <div className="cmdk-head">
          <IconSearch size={17} className="cmdk-search-ic" />
          <input
            className="cmdk-input" value={raw} autoFocus role="combobox" aria-expanded="true" aria-label="Command palette"
            placeholder={cmdMode ? 'Run a command…' : 'Search notes…   (type > for commands)'}
            onChange={(e) => setRaw(e.target.value)} onKeyDown={onKeyDown}
          />
        </div>
        <div className="cmdk-list" ref={listRef} role="listbox">
          {loading ? (
            <div className="cmdk-empty"><IconSpinner size={18} /> Loading…</div>
          ) : unconfigured && !cmdMode ? (
            <div className="cmdk-empty">Notes aren’t configured yet — connect Nextcloud in Settings.</div>
          ) : results.length === 0 ? (
            <div className="cmdk-empty">{cmdMode ? 'No matching command.' : 'No matching note.'}</div>
          ) : results.map((r, i) => {
            const Item = r.item
            const isCmd = cmdMode
            const Ic = isCmd ? (Item.icon || IconPlus) : IconNote
            return (
              <button
                key={isCmd ? Item.id : Item.path} type="button" role="option" aria-selected={i === sel}
                className={`cmdk-row${i === sel ? ' sel' : ''}`}
                onMouseEnter={() => setSel(i)} onClick={() => activate(i)}
              >
                <span className="cmdk-row-ic"><Ic size={15} /></span>
                <span className="cmdk-row-main">
                  <span className="cmdk-row-title"><Highlight text={isCmd ? Item.label : Item.title} positions={r.positions} /></span>
                  {isCmd
                    ? (Item.hint && <span className="cmdk-row-sub">{Item.hint}</span>)
                    : (Item.folder && <span className="cmdk-row-sub"><IconFolder size={11} /> {Item.folder}</span>)}
                </span>
              </button>
            )
          })}
        </div>
        <div className="cmdk-foot">
          <span className="cmdk-foot-keys"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="cmdk-foot-keys"><kbd className="kbd-ic"><IconCornerDownLeft size={11} /></kbd> {cmdMode ? 'run' : 'open'}</span>
          <span className="cmdk-foot-keys"><kbd>esc</kbd> close</span>
          <span className="cmdk-foot-spacer" />
          <span className="cmdk-foot-mode">{cmdMode ? 'Commands' : 'Notes'}</span>
        </div>
      </div>
    </ModalFrame>
  )
}
