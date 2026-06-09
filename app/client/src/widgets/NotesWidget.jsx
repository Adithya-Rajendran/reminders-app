import React, { useCallback, useEffect, useRef, useState } from 'react'
import { notesApi } from '../api.js'
import NoteEditor from '../NoteEditor.jsx'
import { SkeletonRows, EmptyState, ErrorState } from './parts.jsx'
import { IconNote, IconPlus, IconCloud, IconFolder, IconChevR } from '../icons.jsx'

const EXPAND_KEY = 'notes-expanded-folders'
const loadSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set() } }
const TREE_HIDE_W = 440 // below this widget width the tree collapses behind a toggle

// Build a nested folder tree from a flat list of folder paths (e.g. "Work/Projects").
function buildTree(paths) {
  const root = { name: '', path: '', children: {} }
  for (const fp of paths) {
    let node = root, acc = ''
    for (const seg of String(fp).split('/').filter(Boolean)) {
      acc = acc ? acc + '/' + seg : seg
      node.children[seg] = node.children[seg] || { name: seg, path: acc, children: {} }
      node = node.children[seg]
    }
  }
  return root
}
const childrenOf = (node) => Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name))

function FolderNode({ node, depth, sel, expanded, onSelect, onToggle }) {
  const kids = childrenOf(node)
  const isOpen = expanded.has(node.path)
  return (
    <>
      <div className={`tree-row${sel === node.path ? ' sel' : ''}`} style={{ paddingLeft: 6 + depth * 13 }} onClick={() => onSelect(node.path)} title={node.path}>
        {kids.length
          ? <IconChevR size={12} className={`tree-chev${isOpen ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(node.path) }} />
          : <span className="tree-chev-pad" />}
        <IconFolder size={13} />
        <span className="tree-name">{node.name}</span>
      </div>
      {isOpen && kids.map((k) => <FolderNode key={k.path} node={k} depth={depth + 1} sel={sel} expanded={expanded} onSelect={onSelect} onToggle={onToggle} />)}
    </>
  )
}

// Notes widget: a folder tree sidebar (VSCode/Obsidian-style) + the notes of the
// selected folder, filterable by tag. The tree collapses on narrow widgets.
export default function NotesWidget({ onOpenSettings }) {
  const [state, setState] = useState('loading') // loading | ready | error | unconfigured
  const [notes, setNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [sel, setSel] = useState('')      // selected folder path ('' = all notes)
  const [expanded, setExpanded] = useState(() => loadSet(EXPAND_KEY))
  const [q, setQ] = useState('')
  const [tag, setTag] = useState(null)
  const [openPath, setOpenPath] = useState(null)
  const [compact, setCompact] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const wrapRef = useRef(null)

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

  // Collapse the tree on small widget sizes.
  useEffect(() => {
    if (!wrapRef.current || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => setCompact((entries[0].contentRect.width || 999) < TREE_HIDE_W))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const toggleExpand = (path) => setExpanded((prev) => {
    const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path)
    try { localStorage.setItem(EXPAND_KEY, JSON.stringify([...n])) } catch { /* ignore */ }
    return n
  })

  const newNote = async () => {
    try { const n = await notesApi.create(sel, 'Untitled'); setOpenPath(n.path) } catch { /* ignore */ }
  }
  const newFolder = async () => {
    const name = window.prompt(sel ? `New folder inside “${sel}”` : 'New folder name')
    if (!name) return
    const path = sel ? sel + '/' + name.trim() : name.trim()
    try { await notesApi.createFolder(path); setExpanded((p) => new Set([...p, ...path.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))])); setSel(path); await load() } catch { /* ignore */ }
  }

  // folder tree from every folder (incl. empty ones) + folders that only exist via a note path
  const tree = buildTree([...new Set([...folders, ...notes.map((n) => n.folder).filter(Boolean)])])
  const topFolders = childrenOf(tree)
  const allTags = [...new Set(notes.flatMap((n) => n.tags || []))].sort()
  const ql = q.trim().toLowerCase()
  const inSel = (n) => !sel || n.folder === sel || (n.folder || '').startsWith(sel + '/')
  const filtered = notes.filter((n) => inSel(n)
    && (!ql || n.title.toLowerCase().includes(ql) || (n.tags || []).some((t) => t.toLowerCase().includes(ql)))
    && (!tag || (n.tags || []).includes(tag)))

  const row = (n) => (
    <button key={n.path} className="note-row" onClick={() => setOpenPath(n.path)} title={n.title}>
      <IconNote size={15} />
      <span className="note-row-main">
        <span className="note-row-title">{n.title}</span>
        <span className="note-row-meta">
          {n.folder && n.folder !== sel && <span className="note-row-folder"><IconFolder size={11} /> {n.folder}</span>}
          {(n.tags || []).slice(0, 3).map((t) => <span key={t} className="note-tag" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setTag(t) }}>#{t}</span>)}
        </span>
      </span>
      <span className="note-row-date">{relTime(n.updated)}</span>
    </button>
  )

  if (state === 'loading') return <div className="notes-widget" ref={wrapRef}><SkeletonRows /></div>
  if (state === 'error') return <div className="notes-widget" ref={wrapRef}><ErrorState onRetry={load} /></div>
  if (state === 'unconfigured') {
    return (
      <div className="notes-widget" ref={wrapRef}>
        <div className="state">
          <div className="state-ic"><IconCloud size={22} /></div>
          <div className="state-title">Notes need a Nextcloud account</div>
          <div className="state-sub">Notes are saved as files in your Nextcloud — connect that account and pick a folder in Settings.</div>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={onOpenSettings}><IconCloud size={15} /> Open Settings</button>
        </div>
      </div>
    )
  }

  const tree$ = (
    <div className="notes-tree">
      <div className="tree-head">
        <span>Folders</span>
        <span className="tree-head-actions">
          <button className="iconbtn sm" title="New folder" aria-label="New folder" onClick={newFolder}><IconFolder size={14} /></button>
          <button className="iconbtn sm" title="New note here" aria-label="New note here" onClick={newNote}><IconPlus size={15} /></button>
        </span>
      </div>
      <div className={`tree-row${sel === '' ? ' sel' : ''}`} style={{ paddingLeft: 6 }} onClick={() => setSel('')}>
        <span className="tree-chev-pad" /><IconNote size={13} /><span className="tree-name">All notes</span>
      </div>
      {topFolders.map((k) => <FolderNode key={k.path} node={k} depth={0} sel={sel} expanded={expanded} onSelect={setSel} onToggle={toggleExpand} />)}
      {topFolders.length === 0 && <div className="tree-empty">No folders yet</div>}
    </div>
  )

  return (
    <div ref={wrapRef} className={`notes-widget tree${compact ? ' compact' : ''}${compact && treeOpen ? ' tree-open' : ''}`}>
      {(!compact || treeOpen) && tree$}
      <div className="notes-main">
        <div className="note-toolbar">
          {compact && <button className={`iconbtn sm${treeOpen ? ' on' : ''}`} title="Folders" aria-label="Toggle folders" onClick={() => setTreeOpen((o) => !o)}><IconFolder size={16} /></button>}
          <input className="note-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={sel ? `Search in ${sel}…` : 'Search notes…'} aria-label="Search notes" />
          <button className="iconbtn sm" aria-label="New note" title="New note" onClick={newNote}><IconPlus size={16} /></button>
        </div>
        {(tag || allTags.length > 0) && (
          <div className="note-tags-bar">
            {tag
              ? <button className="note-tag on" onClick={() => setTag(null)}>#{tag} ✕</button>
              : allTags.slice(0, 12).map((t) => <button key={t} className="note-tag" onClick={() => setTag(t)}>#{t}</button>)}
          </div>
        )}
        {filtered.length === 0
          ? (notes.length === 0
              ? <EmptyState icon={IconNote} title="No notes yet" sub="Create your first note with the ＋ above." />
              : <div className="note-empty-q">{(ql || tag) ? 'No matching notes.' : 'This folder is empty.'}</div>)
          : <div className="note-list">{filtered.map(row)}</div>}
      </div>
      {openPath && <NoteEditor path={openPath} onClose={() => { setOpenPath(null); load() }} />}
    </div>
  )
}

function relTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h'
  if (diff < 604800) return Math.floor(diff / 86400) + 'd'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
