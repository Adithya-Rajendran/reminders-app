import React, { useCallback, useEffect, useRef, useState } from 'react'
import { notesApi } from '../api.js'
import NoteEditor from '../NoteEditor.jsx'
import PromptModal from '../PromptModal.jsx'
import { SkeletonRows, EmptyState, ErrorState } from './parts.jsx'
import { IconNote, IconPlus, IconCloud, IconFolder, IconChevR, IconChevL } from '../icons.jsx'

const EXPAND_KEY = 'notes-expanded-folders'
const loadSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set() } }
const NARROW = 520 // below this widget width, collapse to a single (master-detail) column

// Build a nested tree of folders (incl. empty) with each note attached to its folder.
function buildTree(folderPaths, notes) {
  const root = { name: '', path: '', children: {}, notes: [] }
  const ensure = (fp) => {
    let node = root, acc = ''
    for (const seg of String(fp).split('/').filter(Boolean)) {
      acc = acc ? acc + '/' + seg : seg
      node.children[seg] = node.children[seg] || { name: seg, path: acc, children: {}, notes: [] }
      node = node.children[seg]
    }
    return node
  }
  for (const fp of folderPaths) ensure(fp)
  for (const n of notes) ensure(n.folder || '').notes.push(n)
  return root
}
const folderKids = (node) => Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name))
const noteKids = (node) => (node.notes || []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
const countNotes = (node) => (node.notes || []).length + folderKids(node).reduce((s, c) => s + countNotes(c), 0)

function TreeLevel({ node, depth, sel, active, expanded, onSelect, onToggle, onOpen }) {
  return (
    <>
      {folderKids(node).map((f) => {
        const isOpen = expanded.has(f.path)
        return (
          <React.Fragment key={f.path}>
            <div className={`tree-row${sel === f.path ? ' sel' : ''}`} style={{ paddingLeft: 6 + depth * 13 }} onClick={() => { onSelect(f.path); onToggle(f.path) }} title={f.path}>
              <IconChevR size={12} className={`tree-chev${isOpen ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(f.path) }} />
              <IconFolder size={13} />
              <span className="tree-name">{f.name}</span>
              <span className="tree-count">{countNotes(f)}</span>
            </div>
            {isOpen && <TreeLevel node={f} depth={depth + 1} sel={sel} active={active} expanded={expanded} onSelect={onSelect} onToggle={onToggle} onOpen={onOpen} />}
          </React.Fragment>
        )
      })}
      {noteKids(node).map((n) => (
        <div key={n.path} className={`tree-row tree-note${active === n.path ? ' active' : ''}`} style={{ paddingLeft: 6 + depth * 13 + 16 }} onClick={() => onOpen(n.path)} title={n.title}>
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
  const [expanded, setExpanded] = useState(() => loadSet(EXPAND_KEY))
  const [q, setQ] = useState('')
  const [tag, setTag] = useState(null)
  const [openPath, setOpenPath] = useState(null)
  const [folderPrompt, setFolderPrompt] = useState(false)
  const [narrow, setNarrow] = useState(false)

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
    try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...n])) } catch { /* ignore */ }
    return n
  })
  const expandAncestors = (path) => setExpanded((prev) => new Set([...prev, ...path.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')).filter(Boolean)]))

  const newNote = async () => {
    try { const n = await notesApi.create(sel, 'Untitled'); if (sel) expandAncestors(sel); await load(); setOpenPath(n.path) } catch { /* ignore */ }
  }
  const createFolder = async (name) => {
    setFolderPrompt(false)
    const path = sel ? sel + '/' + name : name
    try { await notesApi.createFolder(path); expandAncestors(path); setSel(path); await load() } catch { /* ignore */ }
  }

  const allTags = [...new Set(notes.flatMap((n) => n.tags || []))].sort()
  const ql = q.trim().toLowerCase()
  const searching = !!(ql || tag)
  const matches = notes.filter((n) => (!ql || n.title.toLowerCase().includes(ql) || (n.folder || '').toLowerCase().includes(ql) || (n.tags || []).some((t) => t.toLowerCase().includes(ql))) && (!tag || (n.tags || []).includes(tag)))
  const tree = buildTree([...new Set([...folders, ...notes.map((n) => n.folder).filter(Boolean)])], notes)

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
          <div className="notes-tree">
            {notes.length === 0
              ? <EmptyState icon={IconNote} title="No notes yet" sub="Create your first note with the ＋ above." />
              : searching
                ? (matches.length === 0
                    ? <div className="note-empty-q">No matching notes.</div>
                    : matches.map((n) => (
                        <div key={n.path} className={`tree-row tree-note${openPath === n.path ? ' active' : ''}`} style={{ paddingLeft: 8 }} onClick={() => setOpenPath(n.path)} title={n.title}>
                          <IconNote size={13} />
                          <span className="tree-name">{n.title}</span>
                          {n.folder && <span className="tree-note-folder">{n.folder}</span>}
                        </div>
                      )))
                : <TreeLevel node={tree} depth={0} sel={sel} active={openPath} expanded={expanded} onSelect={setSel} onToggle={toggleExpand} onOpen={setOpenPath} />}
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
