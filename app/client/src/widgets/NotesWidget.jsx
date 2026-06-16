import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { notesApi } from '../api.js'
import NoteEditor from '../NoteEditor.jsx'
import PromptModal from '../PromptModal.jsx'
import { buildTree, folderKids, noteKids, countNotes, canDropInto } from '../notetree.js'
import { ancestorsOf } from '../notepaths.js'
import { loadStringSet, saveStringSet } from '../storage.js'
import { SkeletonRows, EmptyState, ErrorState } from './parts.jsx'
import { IconNote, IconPlus, IconCloud, IconFolder, IconChevR, IconChevL } from '../icons.jsx'

const EXPAND_KEY = 'notes-expanded-folders'
const NARROW = 520 // below this widget width, collapse to a single (master-detail) column

function TreeLevel({ node, depth, sel, active, expanded, onSelect, onToggle, onOpen, dnd }) {
  return (
    <>
      {folderKids(node).map((f) => {
        const isOpen = expanded.has(f.path)
        return (
          <Fragment key={f.path}>
            <div
              className={`tree-row${sel === f.path ? ' sel' : ''}${dnd.over === f.path ? ' drag-over' : ''}`}
              style={{ paddingLeft: 6 + depth * 13 }}
              draggable onDragStart={dnd.folderStart(f)} onDragEnd={dnd.end}
              onDragOver={dnd.folderOver(f.path)} onDrop={dnd.folderDrop(f.path)}
              onClick={() => { onSelect(f.path); onToggle(f.path) }} title={f.path}
            >
              <IconChevR size={12} className={`tree-chev${isOpen ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(f.path) }} />
              <IconFolder size={13} />
              <span className="tree-name">{f.name}</span>
              <span className="tree-count">{countNotes(f)}</span>
            </div>
            {isOpen && <TreeLevel node={f} depth={depth + 1} sel={sel} active={active} expanded={expanded} onSelect={onSelect} onToggle={onToggle} onOpen={onOpen} dnd={dnd} />}
          </Fragment>
        )
      })}
      {noteKids(node).map((n) => (
        <div
          key={n.path}
          className={`tree-row tree-note${active === n.path ? ' active' : ''}`}
          style={{ paddingLeft: 6 + depth * 13 + 16 }}
          draggable onDragStart={dnd.noteStart(n)} onDragEnd={dnd.end}
          onDragOver={dnd.noteOver} onDrop={dnd.noteDrop}
          onClick={() => onOpen(n.path)} title={n.title}
        >
          <IconNote size={13} />
          <span className="tree-name">{n.title}</span>
          {(n.tags || []).slice(0, 2).map((t) => <span key={t} className="note-tag mini">#{t}</span>)}
        </div>
      ))}
    </>
  )
}

// Notes widget: an Obsidian/VSCode-style workspace — a folder+note tree in a
// sidebar, the selected note open in the main pane. Collapses to a single
// master-detail column when the widget is narrow.
export default function NotesWidget({ onOpenSettings }) {
  const [state, setState] = useState('loading') // loading | ready | error | unconfigured
  const [notes, setNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [sel, setSel] = useState('')      // active folder (where new items go)
  const [expanded, setExpanded] = useState(() => loadStringSet(EXPAND_KEY))
  const [q, setQ] = useState('')
  const [tag, setTag] = useState(null)
  const [openPath, setOpenPath] = useState(null)
  const [folderPrompt, setFolderPrompt] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [dragItem, setDragItem] = useState(null) // { type:'note'|'folder', path, folder? }
  const [overTarget, setOverTarget] = useState(null) // destination folder rel path ('' = root) | null

  // Track widget width so the layout can collapse to one column when small.
  const roRef = useRef(null)
  const setWrap = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => { const w = entries[0]?.contentRect.width || 0; setNarrow(w > 0 && w < NARROW) })
      ro.observe(el); roRef.current = ro
    }
  }, [])

  const load = useCallback(async () => {
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      const r = await notesApi.list()
      if (!r.configured) { setState('unconfigured'); return }
      setNotes(Array.isArray(r.notes) ? r.notes : [])
      try { const fr = await notesApi.folders(); setFolders((fr.folders || []).filter(Boolean)) } catch { /* keep */ }
      setState('ready')
    } catch { setState('error') }
  }, [])
  useEffect(() => { load() }, [load])

  const toggleExpand = (path) => setExpanded((prev) => {
    const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path)
    saveStringSet(EXPAND_KEY, n)
    return n
  })
  const expandAncestors = (path) => setExpanded((prev) => new Set([...prev, ...ancestorsOf(path)]))

  const newNote = async () => {
    try { const n = await notesApi.create(sel, 'Untitled'); if (sel) expandAncestors(sel); await load(); setOpenPath(n.path) } catch { /* ignore */ }
  }

  // ---- drag & drop: move a note (or folder) into a folder, or out to the root ----
  const doDrop = async (target) => { // target = destination folder rel path ('' = root)
    const d = dragItem; setDragItem(null); setOverTarget(null)
    if (!canDropInto(d, target)) return
    try {
      if (d.type === 'note') {
        const r = await notesApi.move(d.path, target)
        if (openPath === d.path && r?.path) setOpenPath(r.path)
      } else {
        const openNote = notes.find((n) => n.path === openPath)
        const insideMoved = openNote && ((openNote.folder || '') === d.path || (openNote.folder || '').startsWith(d.path + '/'))
        await notesApi.moveFolder(d.path, target)
        if (insideMoved) setOpenPath(null) // the note's path changed — reopen it from the tree
      }
      if (target) expandAncestors(target)
      await load()
    } catch { /* ignore */ }
  }
  const dnd = {
    over: overTarget,
    noteStart: (n) => (e) => { setDragItem({ type: 'note', path: n.path, folder: n.folder || '' }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', n.path) } catch { /* ignore */ } },
    folderStart: (f) => (e) => { e.stopPropagation(); setDragItem({ type: 'folder', path: f.path }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', f.path) } catch { /* ignore */ } },
    folderOver: (path) => (e) => { if (canDropInto(dragItem, path)) { e.preventDefault(); e.stopPropagation(); if (overTarget !== path) setOverTarget(path) } },
    folderDrop: (path) => (e) => { e.preventDefault(); e.stopPropagation(); doDrop(path) },
    noteOver: (e) => { e.stopPropagation() }, // notes aren't drop targets — don't bubble to the root zone
    noteDrop: (e) => { e.preventDefault(); e.stopPropagation() },
    rootOver: (e) => { if (canDropInto(dragItem, '')) { e.preventDefault(); if (overTarget !== '') setOverTarget('') } },
    rootDrop: (e) => { e.preventDefault(); doDrop('') },
    end: () => { setDragItem(null); setOverTarget(null) },
  }
  const createFolder = async (name) => {
    setFolderPrompt(false)
    const path = sel ? sel + '/' + name : name
    try { await notesApi.createFolder(path); expandAncestors(path); setSel(path); await load() } catch { /* ignore */ }
  }

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags || []))].sort(), [notes])
  const ql = q.trim().toLowerCase()
  const searching = !!(ql || tag)
  const matches = useMemo(() => notes.filter((n) => (!ql || n.title.toLowerCase().includes(ql) || (n.folder || '').toLowerCase().includes(ql) || (n.tags || []).some((t) => t.toLowerCase().includes(ql))) && (!tag || (n.tags || []).includes(tag))), [notes, ql, tag])
  const tree = useMemo(() => buildTree([...new Set([...folders, ...notes.map((n) => n.folder).filter(Boolean)])], notes), [folders, notes])

  if (state === 'loading') return <div className="notes-widget"><SkeletonRows /></div>
  if (state === 'error') return <div className="notes-widget"><ErrorState onRetry={load} /></div>
  if (state === 'unconfigured') {
    return (
      <div className="notes-widget">
        <div className="state">
          <div className="state-ic"><IconCloud size={22} /></div>
          <div className="state-title">Notes need a Nextcloud account</div>
          <div className="state-sub">Notes are saved as files in your Nextcloud — connect that account and pick a folder in Settings.</div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={onOpenSettings}><IconCloud size={15} /> Open Settings</button>
        </div>
      </div>
    )
  }

  const showSidebar = !narrow || !openPath
  const showMain = !narrow || !!openPath

  return (
    <div className={`notes-widget notes-split${narrow ? ' narrow' : ''}`} ref={setWrap}>
      {showSidebar && (
        <aside className="notes-sidebar">
          <div className="note-toolbar">
            <input className="note-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search notes" />
            <button className="iconbtn sm" aria-label="New folder" title={sel ? `New folder in ${sel}` : 'New folder'} onClick={() => setFolderPrompt(true)}><IconFolder size={15} /></button>
            <button className="iconbtn sm" aria-label="New note" title={sel ? `New note in ${sel}` : 'New note'} onClick={newNote}><IconPlus size={16} /></button>
          </div>
          {(tag || allTags.length > 0) && (
            <div className="note-tags-bar">
              {tag
                ? <button className="note-tag on" onClick={() => setTag(null)}>#{tag} ✕</button>
                : allTags.slice(0, 12).map((t) => <button key={t} className="note-tag" onClick={() => setTag(t)}>#{t}</button>)}
            </div>
          )}
          <div
            className={`notes-tree${overTarget === '' && dragItem ? ' drag-over-root' : ''}`}
            onDragOver={dnd.rootOver} onDrop={dnd.rootDrop}
          >
            {notes.length === 0 && folders.length === 0
              // Folders exist without notes (created empty in-app or in Nextcloud)
              // and must still render — otherwise a fresh folder looks like the
              // create silently failed. Empty-state only when BOTH are empty.
              ? <EmptyState icon={IconNote} title="No notes yet" sub="Create your first note with the ＋ above." />
              : searching
                ? (matches.length === 0
                    ? <div className="note-empty-q">No matching notes.</div>
                    : matches.map((n) => (
                        <div
                          key={n.path} className={`tree-row tree-note${openPath === n.path ? ' active' : ''}`} style={{ paddingLeft: 8 }}
                          draggable onDragStart={dnd.noteStart(n)} onDragEnd={dnd.end}
                          onDragOver={dnd.noteOver} onDrop={dnd.noteDrop}
                          onClick={() => setOpenPath(n.path)} title={n.title}
                        >
                          <IconNote size={13} />
                          <span className="tree-name">{n.title}</span>
                          {n.folder && <span className="tree-note-folder">{n.folder}</span>}
                        </div>
                      )))
                : <TreeLevel node={tree} depth={0} sel={sel} active={openPath} expanded={expanded} onSelect={setSel} onToggle={toggleExpand} onOpen={setOpenPath} dnd={dnd} />}
          </div>
        </aside>
      )}
      {showMain && (
        <main className="notes-main">
          {narrow && openPath && (
            <button className="notes-back" onClick={() => setOpenPath(null)}><IconChevL size={15} /> Files</button>
          )}
          {openPath
            ? (
              <NoteEditor
                inline path={openPath}
                onClose={() => setOpenPath(null)}
                onChanged={(np) => { if (np) setOpenPath(np); load() }}
                onDeleted={() => { setOpenPath(null); load() }}
              />
            )
            : (
              <div className="notes-main-empty">
                <div className="state-ic"><IconNote size={24} /></div>
                <div className="state-title">Select a note</div>
                <div className="state-sub">Pick one from the tree, or create a note with ＋.</div>
              </div>
            )}
        </main>
      )}
      {folderPrompt && (
        <PromptModal
          title="New folder" label={sel ? `Inside “${sel}”` : 'In Notes (root)'} placeholder="Folder name"
          onSubmit={createFolder} onCancel={() => setFolderPrompt(false)}
        />
      )}
    </div>
  )
}
