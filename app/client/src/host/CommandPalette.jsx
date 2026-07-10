import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import ModalFrame from './ModalFrame.jsx'
import { useModalRef } from '../widget-sdk/useModalRef.js'
import { emitOpenNote } from '../data/notesbus.js'
import { notesApi, api } from '../data/api.js'
import { rankEntries, buildEntries } from '../domain/omnibox.js'
import { selectContexts } from '../domain/taskviews.js'
import { createAndOpenNote } from '../data/noteactions.js'
import { getTasks, subscribe as subscribeTasks } from '../data/taskstore.js'
import { getOrganizerFilter, setOrganizerFilter } from '../domain/organizerfilter.js'
import { emitRevealTask } from '../data/revealbus.js'
import { getBoard, onBoard, flashWidget, emitAddWidget } from '../data/boardbus.js'
import { dueChip } from '../domain/tasklib.js'
import { IconSearch, IconNote, IconPlus, IconFolder, IconList, IconX, IconCornerDownLeft, IconSpinner, IconCheck, IconGrid, IconBolt } from '../widget-sdk/icons.jsx'

// Render a label with its fuzzy-matched characters emphasised. Groups runs so
// the DOM stays small for short titles.
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

// Per-kind default icon + right-aligned tag. A command carries its own icon; the
// others get a stable glyph so the type reads at a glance.
const KIND_ICON = { command: IconBolt, nav: IconGrid, task: IconCheck, note: IconNote, area: IconFolder, context: IconList }
const optionId = (item) => 'cmdk-opt-' + item.id

// App-wide command palette / OMNIBOX. Plain typing fuzzy-searches EVERYTHING at
// once — your commands, board navigation (surfaces, aliased so "triage" finds the
// renamed "Prioritize"), your live tasks, and your notes — with a type tag per row.
// Typing `>` is now an OPTIONAL filter to commands + navigation only. Fully
// keyboard-driven; every row carries a `run`, so activating it just closes + runs.
export default function CommandPalette({ initialMode = 'search', commands = [], onClose }) {
  const [raw, setRaw] = useState(initialMode === 'commands' ? '>' : '')
  const [notes, setNotes] = useState(null) // null = loading | [] | [...]
  const [sel, setSel] = useState(0)
  const listRef = useRef(null)
  const ref = useModalRef(onClose)

  // `>` restricts to commands + navigation (actions), matching the old command
  // mode; without it, the query searches every source.
  const cmdMode = raw.startsWith('>')
  const term = (cmdMode ? raw.slice(1) : raw).trim()

  // Live task list from the shared store (same source every widget reads) — so the
  // omnibox finds a task by its content, not just by navigating to a widget.
  const tasks = useSyncExternalStore(subscribeTasks, getTasks)
  const [areas, setAreas] = useState([])
  const [noteHits, setNoteHits] = useState([]) // server full-text note-BODY matches

  // The note list, loaded once on open (cheap; the server caches it ~15s). A failure
  // or an unconfigured Notes account simply yields no note rows — commands, nav and
  // tasks still work, so the palette never hard-fails on the Notes backend.
  useEffect(() => {
    let alive = true
    notesApi.list().then((r) => {
      if (!alive) return
      if (!r || !r.configured) { setNotes([]); return }
      const list = (r.notes || []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
      setNotes(list)
    }).catch(() => { if (alive) setNotes([]) })
    return () => { alive = false }
  }, [])

  // Areas/Projects for the organizer entries — a small, rarely-changing list; fetch
  // once on open. Contexts are derived from the live task labels (no fetch).
  useEffect(() => {
    let alive = true
    api('/api/areas').then((a) => { if (alive) setAreas(Array.isArray(a) ? a : []) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const contexts = useMemo(() => selectContexts(tasks), [tasks])

  // The current board, for type-aware navigation. A surface already on the board
  // gets "Go to" (scroll + flash); one that isn't gets "Add" (drop it in). Either
  // way the aliases make a renamed surface reachable by its old name.
  // Live board contents — subscribe so nav "Go to/Add" verbs stay correct if a widget
  // is added/removed while the palette is open (a one-shot snapshot would go stale).
  const [board, setBoard] = useState(() => getBoard())
  useEffect(() => onBoard(setBoard), [])

  // Flatten every source into one typed, rankable entry list (see omnibox.buildEntries
  // for the pure wiring). Rebuilt only when a source actually changes (not per
  // keystroke); ranking runs on `term` below. The side-effecting `icon`/`run` fields
  // are injected here — buildEntries itself stays React/DOM-free so the node tests can
  // cover the source/order/id/keys/verb logic. (getOrganizerFilter() is read live, not
  // a memo dep — the pre-refactor behaviour: the Clear-filter row refreshes with the
  // next source change, which is fine since setting a filter changes a source too.)
  const entries = useMemo(() => buildEntries(
    { commands, board, tasks, notes, areas, contexts, filter: getOrganizerFilter() },
    {
      newNoteIcon: IconPlus, clearFilterIcon: IconX, dueChip,
      onNewNote: createAndOpenNote,
      onGoTo: (w) => flashWidget(w.i),
      onAdd: (type) => emitAddWidget(type),
      onScope: setOrganizerFilter,
      onRevealTask: emitRevealTask,
      onOpenNote: emitOpenNote,
    },
  ), [commands, board, tasks, notes, areas, contexts])

  // Full-text note-BODY search (server): the entry list only matches note TITLES,
  // so a word that lives only inside a note's body would never surface. Debounced;
  // the hits merge into the results below, tagged Note. Skipped in command mode.
  useEffect(() => {
    if (cmdMode || !term) { setNoteHits([]); return undefined }
    let alive = true
    const id = setTimeout(() => {
      notesApi.search(term, 8)
        .then((r) => { if (alive) setNoteHits(Array.isArray(r?.results) ? r.results : []) })
        .catch(() => { if (alive) setNoteHits([]) })
    }, 180)
    return () => { alive = false; clearTimeout(id) }
  }, [term, cmdMode])

  // Command-mode filter (`>`) narrows to actions + navigation.
  const pool = useMemo(() => (cmdMode ? entries.filter((e) => e.kind === 'command' || e.kind === 'nav') : entries), [cmdMode, entries])

  // The curated empty-state (blank query): the workflow commands + the core surfaces
  // + a few recent notes — a useful "start here" instead of a blank void. In command
  // mode the whole action pool is shown, priority-ordered.
  const curated = useMemo(() => {
    if (cmdMode) {
      return [...pool].sort((a, b) => (b.priority || 0) - (a.priority || 0))
    }
    const cmds = entries.filter((e) => e.kind === 'command' && (e.priority || 0) >= 1)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, 5)
    const CORE = ['overview', 'inbox', 'triage', 'calendar']
    const nav = CORE.map((tp) => entries.find((e) => e.id === 'nav-' + tp)).filter(Boolean)
    const recentNotes = entries.filter((e) => e.kind === 'note').slice(0, 5)
    return [...cmds, ...nav, ...recentNotes]
  }, [cmdMode, entries, pool])

  // Results: fuzzy-ranked across the pool when there's a query, else the curated list.
  const results = useMemo(() => {
    if (!term) return curated.map((item) => ({ item, positions: [] }))
    const ranked = rankEntries(term, pool).slice(0, 60)
    // Append server full-text note matches the title ranking missed (dedup by path).
    if (!cmdMode && noteHits.length) {
      const seen = new Set(ranked.map((r) => r.item.id))
      for (const h of noteHits) {
        const id = 'note-' + h.path
        if (seen.has(id)) continue
        seen.add(id)
        const snip = Array.isArray(h.snippet) ? h.snippet.map((s) => s.t).join('').trim().slice(0, 70) : ''
        ranked.push({ item: { kind: 'note', id, title: h.title || '(untitled note)', subtitle: snip || h.folder || 'match in note body', tag: 'Note', run: () => emitOpenNote(h.path) }, positions: [] })
      }
    }
    return ranked
  }, [term, pool, curated, cmdMode, noteHits])

  useEffect(() => { setSel(0) }, [cmdMode, term])
  useEffect(() => { if (sel >= results.length) setSel(Math.max(0, results.length - 1)) }, [results.length, sel])
  useEffect(() => { listRef.current?.querySelector('.cmdk-row.sel')?.scrollIntoView({ block: 'nearest' }) }, [sel, results])

  const activate = (i = sel) => {
    const r = results[i]; if (!r) return
    onClose()
    r.item.run?.()
  }
  const PAGE = 8
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (results.length ? (s + 1) % results.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0)) }
    else if (e.key === 'PageDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + PAGE)) }
    else if (e.key === 'PageUp') { e.preventDefault(); setSel((s) => Math.max(0, s - PAGE)) }
    // Home/End jump the RESULT list only while the input is empty — with text in the
    // box they keep their native move-the-caret meaning.
    else if (e.key === 'Home' && !term) { e.preventDefault(); setSel(0) }
    else if (e.key === 'End' && !term) { e.preventDefault(); setSel(Math.max(0, results.length - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); activate() }
  }

  const loadingNotes = notes === null

  return (
    <ModalFrame overlayClass="cmdk-overlay" modalClass="cmdk" ariaLabel="Command palette" onBackdrop={onClose}>
      <div ref={ref} className="cmdk-inner">
        <div className="cmdk-head">
          <IconSearch size={17} className="cmdk-search-ic" />
          <input
            className="cmdk-input" value={raw} autoFocus role="combobox" aria-expanded="true" aria-label="Command palette"
            aria-controls="cmdk-listbox" aria-haspopup="listbox"
            aria-activedescendant={results[sel] ? optionId(results[sel].item) : undefined}
            placeholder={cmdMode ? 'Run a command…' : 'Search tasks, notes, commands…   (type > for commands only)'}
            onChange={(e) => setRaw(e.target.value)} onKeyDown={onKeyDown}
          />
        </div>
        <div className="cmdk-list" id="cmdk-listbox" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="inline-empty cmdk-empty">
              {loadingNotes && !term ? <><IconSpinner size={18} /> Loading…</> : cmdMode ? 'No matching command.' : 'No matches — try a task title, note, or command.'}
            </div>
          ) : results.map((r, i) => {
            const it = r.item
            const Ic = it.icon || KIND_ICON[it.kind] || IconBolt
            return (
              <button
                key={it.id} id={optionId(it)} type="button" role="option" aria-selected={i === sel}
                className={`cmdk-row cmdk-kind-${it.kind}${i === sel ? ' sel' : ''}`}
                onMouseEnter={() => setSel(i)} onClick={() => activate(i)}
              >
                <span className="cmdk-row-ic"><Ic size={15} /></span>
                <span className="cmdk-row-main">
                  <span className="cmdk-row-title"><Highlight text={it.title} positions={r.positions} /></span>
                  {it.kind === 'note' && it.folder
                    ? <span className="cmdk-row-sub"><IconFolder size={11} /> {it.folder}</span>
                    : (it.subtitle && <span className="cmdk-row-sub">{it.subtitle}</span>)}
                </span>
                {it.tag && <span className={`cmdk-tag cmdk-tag-${it.kind}`}>{it.tag}</span>}
              </button>
            )
          })}
        </div>
        <div className="cmdk-foot">
          <span className="cmdk-foot-keys"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="cmdk-foot-keys"><kbd className="kbd-ic"><IconCornerDownLeft size={11} /></kbd> open</span>
          <span className="cmdk-foot-keys"><kbd>esc</kbd> close</span>
          {!cmdMode && <span className="cmdk-foot-keys"><kbd>&gt;</kbd> commands only</span>}
          <span className="cmdk-foot-spacer" />
          <span className="cmdk-foot-mode">{cmdMode ? 'Commands' : 'All'}</span>
        </div>
      </div>
    </ModalFrame>
  )
}
