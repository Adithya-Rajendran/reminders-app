import React, { useCallback, useEffect, useState } from 'react'
import { notesApi } from '../api.js'
import NoteEditor from '../NoteEditor.jsx'
import { SkeletonRows, EmptyState, ErrorState } from './parts.jsx'
import { IconNote, IconPlus, IconCloud, IconFolder, IconChevR } from '../icons.jsx'

const COLLAPSE_KEY = 'notes-collapsed-folders'
const loadCollapsed = () => { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')) } catch { return new Set() } }

// Notes widget: Markdown notes from the user's Nextcloud, grouped by folder and
// filterable by tag. Opening a note launches the full-screen NoteEditor.
export default function NotesWidget({ onOpenSettings }) {
  const [state, setState] = useState('loading') // loading | ready | error | unconfigured
  const [notes, setNotes] = useState([])
  const [q, setQ] = useState('')
  const [tag, setTag] = useState(null)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [openPath, setOpenPath] = useState(null)

  const load = useCallback(async () => {
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      const r = await notesApi.list()
      if (!r.configured) { setState('unconfigured'); return }
      setNotes(Array.isArray(r.notes) ? r.notes : [])
      setState('ready')
    } catch { setState('error') }
  }, [])
  useEffect(() => { load() }, [load])

  const toggleFolder = (key) => setCollapsed((prev) => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key)
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n])) } catch { /* ignore */ }
    return n
  })

  const submitNew = async (e) => {
    e?.preventDefault()
    try { const n = await notesApi.create(newFolder.trim(), newTitle.trim() || 'Untitled'); setAdding(false); setNewTitle(''); setNewFolder(''); setOpenPath(n.path) } catch { /* ignore */ }
  }

  const allTags = [...new Set(notes.flatMap((n) => n.tags || []))].sort()
  const folders = [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort()
  const ql = q.trim().toLowerCase()
  const filtered = notes.filter((n) =>
    (!ql || n.title.toLowerCase().includes(ql) || (n.folder || '').toLowerCase().includes(ql) || (n.tags || []).some((t) => t.toLowerCase().includes(ql)))
    && (!tag || (n.tags || []).includes(tag)))
  const flat = !!(ql || tag) // grouped by folder normally; flat list while filtering

  const row = (n) => (
    <button key={n.path} className="note-row" onClick={() => setOpenPath(n.path)} title={n.title}>
      <IconNote size={15} />
      <span className="note-row-main">
        <span className="note-row-title">{n.title}</span>
        <span className="note-row-meta">
          {flat && n.folder && <span className="note-row-folder"><IconFolder size={11} /> {n.folder}</span>}
          {(n.tags || []).slice(0, 3).map((t) => <span key={t} className="note-tag" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setTag(t) }}>#{t}</span>)}
        </span>
      </span>
      <span className="note-row-date">{relTime(n.updated)}</span>
    </button>
  )

  let listBody
  if (filtered.length === 0) listBody = <div className="note-empty-q">{(ql || tag) ? 'No matching notes.' : 'No notes yet — add one above.'}</div>
  else if (flat) listBody = <div className="note-list">{filtered.map(row)}</div>
  else {
    const groups = {}
    for (const n of filtered) (groups[n.folder] ||= []).push(n)
    const keys = Object.keys(groups).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    listBody = keys.map((folder) => {
      const key = folder || '__root'; const isCol = collapsed.has(key)
      return (
        <div key={key} className="note-folder-sec">
          <button type="button" className="group-head note-folder-head" aria-expanded={!isCol} onClick={() => toggleFolder(key)}>
            <IconChevR size={13} className={`rem-chev${isCol ? '' : ' open'}`} />
            <IconFolder size={13} />
            <span className="g-title">{folder || 'Notes'}</span>
            <span className="g-count">{groups[folder].length}</span>
          </button>
          {!isCol && <div className="note-list">{groups[folder].map(row)}</div>}
        </div>
      )
    })
  }

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

  return (
    <div className="notes-widget">
      <div className="note-toolbar">
        <input className="note-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search notes" />
        <button className="iconbtn sm" aria-label="New note" title="New note" onClick={() => setAdding((a) => !a)}><IconPlus size={16} /></button>
      </div>
      {adding && (
        <form className="note-new" onSubmit={submitNew}>
          <input autoFocus className="note-search" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Note title…" aria-label="New note title" />
          <input className="note-folder-in" list="note-folders" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Folder (optional)" aria-label="Folder" />
          <datalist id="note-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          <button type="submit" className="btn primary sm">Add</button>
        </form>
      )}
      {(tag || allTags.length > 0) && (
        <div className="note-tags-bar">
          {tag
            ? <button className="note-tag on" onClick={() => setTag(null)}>#{tag} ✕</button>
            : allTags.slice(0, 12).map((t) => <button key={t} className="note-tag" onClick={() => setTag(t)}>#{t}</button>)}
        </div>
      )}
      {notes.length === 0 && !adding
        ? <EmptyState icon={IconNote} title="No notes yet" sub="Create your first note with the ＋ above." />
        : listBody}
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
