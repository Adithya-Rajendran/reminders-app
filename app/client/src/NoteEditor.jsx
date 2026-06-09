import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import ModalFrame from './ModalFrame.jsx'
import { notesApi } from './api.js'
import { IconX, IconTrash, IconSpinner, IconCheck, IconFolder } from './icons.jsx'

// Tiptap is heavy (loaded only when a note is open) — code-split it out.
const NoteRichEditor = lazy(() => import('./NoteRichEditor.jsx'))

// Full-screen note editor: a live WYSIWYG body (debounced autosave to Nextcloud)
// plus a meta bar for the note's folder + tags.
export default function NoteEditor({ path: initialPath, onClose }) {
  const [path, setPath] = useState(initialPath)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [etag, setEtag] = useState(null)
  const [tags, setTags] = useState([])
  const [folder, setFolder] = useState('')
  const [folders, setFolders] = useState([])
  const [newTag, setNewTag] = useState('')
  const [state, setState] = useState('loading') // loading | ready | error
  const [saving, setSaving] = useState('idle')   // idle | saving | saved | error
  const saveTimer = useRef(null)
  const bodyRef = useRef('')
  const pathRef = useRef(initialPath)
  const etagRef = useRef(null)
  const tagsRef = useRef([])
  const stateRef = useRef('loading')
  const inFlight = useRef(false)
  const pending = useRef(false)
  const dirty = useRef(false)
  pathRef.current = path
  etagRef.current = etag
  tagsRef.current = tags
  stateRef.current = state

  useEffect(() => {
    let alive = true
    dirty.current = false
    notesApi.get(initialPath)
      .then((n) => { if (!alive) return; setTitle(n.title); setBody(n.body); bodyRef.current = n.body; setEtag(n.etag); setTags(n.meta?.tags || []); setFolder(n.folder || ''); setState('ready') })
      .catch(() => { if (alive) setState('error') })
    notesApi.folders().then((r) => { if (alive) setFolders(r.folders || []) }).catch(() => {})
    return () => { alive = false }
  }, [initialPath])

  // Serialized autosave: never overlap two PUTs; a save requested mid-flight is
  // coalesced into one trailing save with the latest body + tags.
  const doSave = async () => {
    if (inFlight.current) { pending.current = true; return }
    if (!dirty.current) return
    inFlight.current = true; dirty.current = false; setSaving('saving')
    try { const r = await notesApi.save(pathRef.current, bodyRef.current, etagRef.current, tagsRef.current); setEtag(r.etag); setSaving('saved') }
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

  // tags + folder edits save immediately (discrete changes)
  const changeTags = (next) => { setTags(next); tagsRef.current = next; dirty.current = true; doSave() }
  const addTag = () => { const t = newTag.trim().replace(/[#,]/g, ''); if (t && !tags.includes(t)) changeTags([...tags, t]); setNewTag('') }
  const removeTag = (t) => changeTags(tags.filter((x) => x !== t))
  const moveTo = async (f) => {
    const target = (f || '').trim()
    if (target === (folder || '')) return
    try { const r = await notesApi.move(pathRef.current, target); setPath(r.path); setFolder(r.folder || '') } catch { /* ignore */ }
  }

  const folderOpts = [...new Set([folder, ...folders].filter(Boolean))].sort()

  return (
    <ModalFrame overlayClass="note-overlay" modalClass="note-editor" ariaLabel="Note editor" onBackdrop={close}>
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
      {state === 'ready' && (
        <div className="note-edit-meta">
          <label className="note-folder-pick" title="Move to folder">
            <IconFolder size={14} />
            <select
              value={folder}
              onChange={(e) => { const v = e.target.value; if (v === '__new') { const f = window.prompt('New folder name'); if (f) moveTo(f) } else moveTo(v) }}
              aria-label="Folder"
            >
              <option value="">Notes (root)</option>
              {folderOpts.map((f) => <option key={f} value={f}>{f}</option>)}
              <option value="__new">＋ New folder…</option>
            </select>
          </label>
          <div className="note-tags-edit">
            {tags.map((t) => (
              <span key={t} className="note-tag">#{t}<button type="button" className="note-tag-x" aria-label={`Remove tag ${t}`} onClick={() => removeTag(t)}>✕</button></span>
            ))}
            <input
              className="note-tag-in" value={newTag} onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } else if (e.key === 'Backspace' && !newTag && tags.length) removeTag(tags[tags.length - 1]) }}
              onBlur={addTag} placeholder="add tag…" aria-label="Add tag"
            />
          </div>
        </div>
      )}
      <div className="note-edit-body">
        {state === 'loading' ? <div className="note-loading"><IconSpinner size={20} /></div>
          : state === 'error' ? <div className="note-loading">Couldn’t load this note.</div>
            : (
              <Suspense fallback={<div className="note-loading"><IconSpinner size={20} /></div>}>
                <NoteRichEditor value={body} onChange={onBody} />
              </Suspense>
            )}
      </div>
    </ModalFrame>
  )
}
