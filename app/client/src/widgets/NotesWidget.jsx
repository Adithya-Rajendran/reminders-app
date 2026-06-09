import React, { useCallback, useEffect, useState } from 'react'
import { notesApi } from '../api.js'
import NoteEditor from '../NoteEditor.jsx'
import { SkeletonRows, EmptyState, ErrorState } from './parts.jsx'
import { IconNote, IconPlus, IconCloud, IconFolder } from '../icons.jsx'

// Notes widget: a searchable list of the user's Markdown notes (stored in their
// Nextcloud over WebDAV). Opening a note launches the full-screen NoteEditor.
export default function NotesWidget({ onOpenSettings }) {
  const [state, setState] = useState('loading') // loading | ready | error | unconfigured
  const [notes, setNotes] = useState([])
  const [q, setQ] = useState('')
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

  const newNote = async () => {
    try { const n = await notesApi.create('', 'Untitled'); setOpenPath(n.path) } catch { /* ignore */ }
  }

  const ql = q.trim().toLowerCase()
  const filtered = ql ? notes.filter((n) => n.title.toLowerCase().includes(ql) || (n.folder || '').toLowerCase().includes(ql)) : notes

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (state === 'unconfigured') {
    body = (
      <div className="state">
        <div className="state-ic"><IconCloud size={22} /></div>
        <div className="state-title">Notes need a cloud folder</div>
        <div className="state-sub">Connect a CalDAV account, then notes save to your Nextcloud.</div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={onOpenSettings}><IconCloud size={15} /> Open Settings</button>
      </div>
    )
  } else if (notes.length === 0) {
    body = <EmptyState icon={IconNote} title="No notes yet" sub="Create your first note with the ＋ above." />
  } else {
    body = (
      <div className="note-list">
        {filtered.map((n) => (
          <button key={n.path} className="note-row" onClick={() => setOpenPath(n.path)} title={n.title}>
            <IconNote size={15} />
            <span className="note-row-main">
              <span className="note-row-title">{n.title}</span>
              {n.folder && <span className="note-row-folder"><IconFolder size={11} /> {n.folder}</span>}
            </span>
            <span className="note-row-date">{relTime(n.updated)}</span>
          </button>
        ))}
        {filtered.length === 0 && <div className="note-empty-q">No notes match “{q}”.</div>}
      </div>
    )
  }

  return (
    <div className="notes-widget">
      {state !== 'unconfigured' && state !== 'error' && (
        <div className="note-toolbar">
          <input className="note-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search notes" />
          <button className="iconbtn sm" aria-label="New note" title="New note" onClick={newNote}><IconPlus size={16} /></button>
        </div>
      )}
      {body}
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
