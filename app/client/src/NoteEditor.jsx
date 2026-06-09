import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { notesApi } from './api.js'
import { IconX, IconTrash, IconSpinner, IconCheck } from './icons.jsx'

// Full-screen note editor overlay. Phase 2 uses a plain Markdown textarea with
// debounced autosave to the user's Nextcloud (over WebDAV); Phase 3 swaps the
// textarea for a live WYSIWYG editor.
export default function NoteEditor({ path: initialPath, onClose }) {
  const [path, setPath] = useState(initialPath)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [etag, setEtag] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [saving, setSaving] = useState('idle')   // idle | saving | saved | error
  const saveTimer = useRef(null)
  const bodyRef = useRef('')
  const pathRef = useRef(initialPath)
  const etagRef = useRef(null)
  const stateRef = useRef('loading')
  const inFlight = useRef(false)
  const pending = useRef(false)
  const dirty = useRef(false)
  pathRef.current = path
  etagRef.current = etag
  stateRef.current = state

  useEffect(() => {
    let alive = true
    dirty.current = false
    notesApi.get(initialPath)
      .then((n) => { if (!alive) return; setTitle(n.title); setBody(n.body); bodyRef.current = n.body; setEtag(n.etag); setState('ready') })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [initialPath])

  // Serialized autosave: never overlap two PUTs; a save requested mid-flight is
  // coalesced into one trailing save with the latest body.
  const doSave = async () => {
    if (inFlight.current) { pending.current = true; return }
    if (!dirty.current) return
    inFlight.current = true; dirty.current = false; setSaving('saving')
    try { const r = await notesApi.save(pathRef.current, bodyRef.current, etagRef.current); setEtag(r.etag); setSaving('saved') }
    catch { dirty.current = true; setSaving('error') }
    finally { inFlight.current = false; if (pending.current) { pending.current = false; doSave() } }
  }
  const onBody = (text) => {
    setBody(text); bodyRef.current = text; dirty.current = true; setSaving('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(doSave, 700)
  }
  const close = async () => {
    clearTimeout(saveTimer.current)
    try { if (stateRef.current === 'ready' && dirty.current) await doSave() } catch { /* best effort */ }
    onClose?.()
  }
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, []) // close reads refs, so a stable handler is correct

  const commitTitle = async () => {
    const t = title.trim()
    const cur = path.split('/').pop().replace(/\.md$/i, '')
    if (!t || t === cur) { setTitle(cur); return }
    try { const r = await notesApi.rename(path, t); setPath(r.path); setTitle(r.title) } catch { setTitle(cur) }
  }
  const del = async () => {
    clearTimeout(saveTimer.current)
    try { await notesApi.del(path); onClose?.() } catch { setSaving('error') } // keep open on failure
  }

  return createPortal(
    <div className="overlay note-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="note-editor" role="dialog" aria-modal="true" aria-label="Note editor">
        <div className="note-edit-head">
          <input
            className="note-title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="Untitled" aria-label="Note title"
          />
          <span className="note-save-state">
            {saving === 'saving' ? <><IconSpinner size={13} /> Saving…</> : saving === 'saved' ? <><IconCheck size={13} /> Saved</> : saving === 'error' ? 'Save failed' : ''}
          </span>
          <button className="iconbtn sm danger-hover" title="Delete note" aria-label="Delete note" onClick={del}><IconTrash size={16} /></button>
          <button className="iconbtn sm" title="Close" aria-label="Close note" onClick={close}><IconX size={16} /></button>
        </div>
        <div className="note-edit-body">
          {state === 'loading' ? <div className="note-loading"><IconSpinner size={20} /></div>
            : state === 'error' ? <div className="note-loading">Couldn’t load this note.</div>
              : <textarea className="note-textarea" value={body} onChange={(e) => onBody(e.target.value)} placeholder="Start writing… (Markdown supported)" autoFocus />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
