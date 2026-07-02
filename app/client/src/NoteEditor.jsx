import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import ModalFrame from './ModalFrame.jsx'
import PromptModal from './PromptModal.jsx'
import Backlinks from './Backlinks.jsx'
import Outline from './Outline.jsx'
import NoteInfoBar from './NoteInfoBar.jsx'
import { notesApi } from './api.js'
import { createSaveQueue } from './savequeue.js'
import { extractOutline } from './outline.js'
import { loadJson, saveJson } from './storage.js'
import { IconX, IconTrash, IconSpinner, IconCheck, IconFolder, IconList, IconPin, IconRefresh } from './icons.jsx'
import { announce } from './widget-sdk/ui/announcer.jsx'

// Tiptap is heavy (loaded only when a note is open) — code-split it out.
const NoteRichEditor = lazy(() => import('./NoteRichEditor.jsx'))

// A live WYSIWYG note body (debounced autosave to Nextcloud) plus a meta bar for
// the note's folder + tags. Renders full-screen (ModalFrame) by default, or inline
// inside a pane when `inline` is set (the split-view notes widget). `onChanged` is
// called after a rename/move so the surrounding tree can refresh; `onDeleted` after
// a delete.
export default function NoteEditor({ path: initialPath, onClose, onChanged, onDeleted, inline = false, notes = [], extEtag = null }) {
  const [path, setPath] = useState(initialPath)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [etag, setEtag] = useState(null)
  const [tags, setTags] = useState([])
  const [meta, setMeta] = useState(null)
  const [folder, setFolder] = useState('')
  const [folders, setFolders] = useState([])
  const [newTag, setNewTag] = useState('')
  const [state, setState] = useState('loading') // loading | ready | error
  const [saving, setSaving] = useState('idle')   // idle | unsaved | saving | saved | error
  const [lastSaveError, setLastSaveError] = useState(null) // the last Error from a failed save
  // loadTick: incrementing this re-runs the load effect (used by the note-load
  // Retry button without changing initialPath — a re-mount-level reload).
  const [loadTick, setLoadTick] = useState(0)
  const lastLoadTickRef = useRef(0)
  const [folderPrompt, setFolderPrompt] = useState(false)
  const [showOutline, setShowOutline] = useState(() => loadJson('notes-outline-open', false))
  const bodyElRef = useRef(null)
  const titleElRef = useRef(null)
  // Set when the loaded note looks brand-new (Untitled + empty body): the next
  // ready-render focuses and selects the title so typing replaces "Untitled"
  // instead of appending to it.
  const wantTitleFocus = useRef(false)
  const saveTimer = useRef(null)
  const bodyRef = useRef('')
  const pathRef = useRef(initialPath)
  const etagRef = useRef(null)
  const tagsRef = useRef([])
  const stateRef = useRef('loading')
  const savingRef = useRef('idle')
  pathRef.current = path
  etagRef.current = etag
  tagsRef.current = tags
  stateRef.current = state
  savingRef.current = saving

  // Serialized autosave (savequeue.js): never overlap two PUTs; a save requested
  // mid-flight coalesces into one trailing save with the latest body + tags.
  const queue = useRef(null)
  if (!queue.current) {
    queue.current = createSaveQueue({
      save: async () => {
        const p = pathRef.current
        const r = await notesApi.save(p, bodyRef.current, etagRef.current, tagsRef.current)
        // Ref synchronously, not just state: a coalesced trailing save chains
        // synchronously off this one and reads etagRef before React re-renders —
        // with only setEtag it would send the stale If-Match and false-409.
        if (pathRef.current === p) { etagRef.current = r.etag; setEtag(r.etag) } // the pane may have switched notes mid-PUT
      },
      // onState now receives (state, error?) — we store the error for conflict UX.
      onState: (s, err) => {
        // Update the ref synchronously, not just via render: close() checks it
        // right after an awaited flush, and the render that would refresh the
        // ref hasn't happened yet at that point — without this, a failed
        // flush-on-close slips past the guard and the edits are lost silently.
        savingRef.current = s
        setSaving(s)
        if (s === 'error') {
          setLastSaveError(err || null)
          // Through the app-level live region — a conditionally-rendered
          // role="alert" span is rarely read (same rationale as ReconnectBanner).
          announce(err?.status === 409 ? 'This note changed somewhere else — resolve the conflict' : 'Save failed')
        } else if (s === 'saved') setLastSaveError(null)
      },
    })
  }

  useEffect(() => {
    // Skip the reload when the parent just re-points us at our own (renamed/moved)
    // path — we're already showing it, so a refetch would only flash. Compare
    // loadTick against the LAST-SEEN tick (not 0): comparing to the constant
    // would permanently disable this skip once Retry has bumped the tick.
    if (loadTick === lastLoadTickRef.current && initialPath === pathRef.current && stateRef.current === 'ready') return undefined
    lastLoadTickRef.current = loadTick
    let alive = true
    setState('loading')
    // Switching to another note: save pending edits to the old path now — the
    // reset() below would silently drop them.
    clearTimeout(saveTimer.current)
    if (stateRef.current === 'ready' && queue.current.isDirty()) queue.current.flush()
    queue.current.reset()
    setLastSaveError(null)
    notesApi.get(initialPath)
      // setPath keeps pathRef in sync with what's loaded — without it, autosaves
      // after a switch PUT the new body at the OLD note's path (and 412).
      .then((n) => {
        if (!alive) return
        setPath(initialPath); setTitle(n.title); setBody(n.body)
        bodyRef.current = n.body; setEtag(n.etag); setTags(n.meta?.tags || [])
        setMeta(n.meta || null); setFolder(n.folder || ''); setState('ready')
        wantTitleFocus.current = /^untitled( \d+)?$/i.test(n.title || '') && !(n.body || '').trim()
      })
      .catch(() => { if (alive) setState('error') })
    notesApi.folders().then((r) => { if (alive) setFolders(r.folders || []) }).catch(() => {})
    return () => { alive = false }
  }, [initialPath, loadTick]) // loadTick lets the Retry button re-run this without changing path

  // The host rewrote this note server-side (e.g. pin from the tree context
  // menu) and hands us the fresh etag — apply it or the next autosave sends a
  // stale If-Match and false-409s.
  useEffect(() => {
    if (extEtag?.etag && extEtag.path === pathRef.current) {
      etagRef.current = extEtag.etag
      setEtag(extEtag.etag)
    }
  }, [extEtag])

  // After the ready-render commits, honor a pending new-note title focus.
  useEffect(() => {
    if (state !== 'ready' || !wantTitleFocus.current) return
    wantTitleFocus.current = false
    titleElRef.current?.focus()
    titleElRef.current?.select()
  }, [state])

  // Register a beforeunload guard while there is unsaved or in-flight data.
  // Only registered on the full-screen modal (not inline pane) so the guard
  // doesn't block navigating away from the dashboard while a widget autosave runs.
  // 'error' is also dangerous: covers both 409 conflict (dirty=false but body
  // edits are pending resolution) and network error (dirty=true, retry pending).
  useEffect(() => {
    if (inline) return undefined
    const isDangerous = () => saving === 'unsaved' || saving === 'saving' || saving === 'error'
    const handler = (e) => { if (isDangerous()) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [inline, saving])

  const onBody = (text) => {
    setBody(text); bodyRef.current = text; queue.current.markDirty(); setSaving('unsaved')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(queue.current.flush, 700)
  }

  // close() guards: if the last flush failed (error state), keep the editor open
  // and show the error — silently discarding unsaved data is the worst outcome.
  // This covers both the 409 conflict case (dirty=false but edits need resolution)
  // and network-error cases (dirty=true, retry is offered). A blocked close must
  // still offer a way OUT (server could be down for good): the first attempt
  // arms an explicit "Discard & close" confirm instead of silently doing nothing.
  // State drives the button label; the ref is what close() reads — close is
  // captured by a stable Escape-key handler, so it must not close over state.
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const confirmDiscardRef = useRef(false)
  const armDiscard = (v) => { confirmDiscardRef.current = v; setConfirmDiscard(v) }
  useEffect(() => { if (saving !== 'error' && confirmDiscardRef.current) armDiscard(false) }, [saving])
  const close = async () => {
    clearTimeout(saveTimer.current)
    // Already in an error state → stay open so the user can see and resolve it;
    // a second, explicit click on "Discard & close" abandons the edits.
    if (savingRef.current === 'error') {
      if (confirmDiscardRef.current) { queue.current.reset(); onClose?.() }
      else armDiscard(true)
      return
    }
    if (stateRef.current === 'ready') {
      // No isDirty() gate: a save can be mid-air with dirty=false, and flush()
      // resolves at full quiescence (in-flight + trailing coalesced save), so
      // this await is what actually prevents closing over an unsettled save.
      try {
        await queue.current.flush()
        // Keystrokes can land while the close-triggered save is mid-air; don't
        // unmount past them — keep flushing until clean (or a save fails).
        while (savingRef.current !== 'error' && queue.current.isDirty()) await queue.current.flush()
      } catch {
        // flush itself doesn't throw (errors go to onState); this catch is for
        // any unexpected rejection path — surface in state, do NOT close.
        savingRef.current = 'error'
        setSaving('error')
        return
      }
      // If onState set us to 'error', the flush failed — stay open. (onState
      // updates savingRef synchronously, so this read is race-free.)
      if (savingRef.current === 'error') return
    }
    onClose?.()
  }

  useEffect(() => {
    if (inline) return undefined // inside a widget pane Esc shouldn't close the note
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inline]) // close reads refs, so a stable handler is correct

  const commitTitle = async () => {
    const t = title.trim()
    const cur = path.split('/').pop().replace(/\.md$/i, '')
    if (!t || t === cur) { setTitle(cur); return }
    try {
      const r = await notesApi.rename(path, t)
      // Apply the returned etag so the next body save uses the fresh one; a
      // MOVE (WebDAV) gets a new etag on the server and stale etags cause 409.
      if (r.etag) setEtag(r.etag)
      setPath(r.path); setTitle(r.title); onChanged?.(r.path)
    } catch { setTitle(cur) }
  }
  const del = async () => {
    clearTimeout(saveTimer.current)
    // Pass the trashed path up so the host (notes widget) can offer an Undo that
    // restores exactly this note; fall back to onClose when there's no handler.
    try { await notesApi.trash(path); (onDeleted ? onDeleted(path) : onClose?.()) } catch { setSaving('error') } // keep open on failure
  }

  // tags + folder edits save immediately (discrete changes)
  const changeTags = (next) => { setTags(next); tagsRef.current = next; queue.current.markDirty(); queue.current.flush() }
  const addTag = () => { const t = newTag.trim().replace(/[#,]/g, ''); if (t && !tags.includes(t)) changeTags([...tags, t]); setNewTag('') }
  const removeTag = (t) => changeTags(tags.filter((x) => x !== t))
  const moveTo = async (f) => {
    const target = (f || '').trim()
    if (target === (folder || '')) return
    try {
      const r = await notesApi.move(pathRef.current, target)
      // Apply returned etag: a MOVE gives the file a new etag on the server;
      // without updating it here, the next autosave sends a stale If-Match → 409.
      if (r.etag) setEtag(r.etag)
      setPath(r.path); setFolder(r.folder || ''); onChanged?.(r.path)
    } catch { /* ignore */ }
  }

  // ---- 409 conflict resolution ----
  const isConflict = saving === 'error' && lastSaveError?.status === 409

  // [Reload]: fetch the server's current version and take ALL of it — body,
  // etag, tags, meta, title, folder. The remote change that caused the conflict
  // may have touched any of these; keeping stale tags would silently overwrite
  // the remote tag change on the next save (with a now-fresh etag).
  const conflictReload = async () => {
    try {
      const n = await notesApi.get(pathRef.current)
      // Update refs immediately (used synchronously in the next save) and state
      // (React re-render). bodyRef must be in sync with the new body so a
      // rapid edit immediately after reload doesn't re-queue the old body.
      bodyRef.current = n.body; etagRef.current = n.etag; tagsRef.current = n.meta?.tags || []
      setBody(n.body); setEtag(n.etag); setTags(n.meta?.tags || [])
      setMeta(n.meta || null); setTitle(n.title); setFolder(n.folder || '')
      queue.current.reset(); setSaving('idle'); setLastSaveError(null)
    } catch { /* stay in conflict state if the reload itself fails */ }
  }

  // [Keep mine]: fetch only the current etag (with a lightweight HEAD-equivalent
  // GET), update etagRef, then immediately flush our pending body.
  const conflictKeepMine = async () => {
    try {
      const n = await notesApi.get(pathRef.current)
      // Update both the ref (used synchronously inside the queue's save()) and
      // the state (so future renders show the correct etag).
      etagRef.current = n.etag
      setEtag(n.etag)
      queue.current.markDirty()
      await queue.current.flush()
    } catch { /* stay in conflict state — e.g. network down */ }
  }

  // 'Saved' chip: auto-fade back to idle after 2.5 s so the bar isn't cluttered.
  useEffect(() => {
    if (saving !== 'saved') return undefined
    const t = setTimeout(() => setSaving('idle'), 2500)
    return () => clearTimeout(t)
  }, [saving])

  const folderOpts = [...new Set([folder, ...folders].filter(Boolean))].sort()
  const pinned = !!meta?.pinned
  const togglePin = async () => {
    try {
      const r = await notesApi.setPinned(pathRef.current, !pinned)
      // setPinned rewrites the file server-side (new etag). Apply it — to the
      // ref synchronously, since the save queue reads etagRef mid-flight — or
      // the next autosave's If-Match is stale and 409s with a spurious
      // "changed somewhere else" conflict banner.
      if (r?.etag) { etagRef.current = r.etag; setEtag(r.etag) }
      setMeta((m) => ({ ...(m || {}), pinned: !pinned })); onChanged?.()
    } catch { /* ignore */ }
  }
  const outline = useMemo(() => extractOutline(body), [body])
  const toggleOutline = (v) => { setShowOutline(v); saveJson('notes-outline-open', v) }
  // The editor renders headings in document order, so the Nth outline entry is
  // the Nth heading element — scroll it into view inside the editor's scroller.
  const scrollToHeading = (i) => {
    const hs = bodyElRef.current?.querySelectorAll('.tiptap-content h1, .tiptap-content h2, .tiptap-content h3, .tiptap-content h4, .tiptap-content h5, .tiptap-content h6')
    hs?.[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const inner = (
    <>
      <div className="note-edit-head">
        <input
          ref={titleElRef}
          className="note-title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder="Untitled" aria-label="Note title"
        />
        <span className={`note-save-state${saving === 'error' ? ' err' : ''}`}>
          {saving === 'unsaved' ? 'Unsaved…'
            : saving === 'saving' ? <><IconSpinner size={13} /> Saving…</>
            : saving === 'saved' ? <><IconCheck size={13} /> Saved</>
            : saving === 'error' && !isConflict
              ? <><span>Save failed</span><button className="undo-btn" style={{ marginLeft: 6 }} onClick={queue.current.flush}>Retry</button></>
            : null}
        </span>
        <button className={`iconbtn sm${pinned ? ' on' : ''}`} title={pinned ? 'Unpin' : 'Pin to top'} aria-label="Pin note" onClick={togglePin}><IconPin size={16} /></button>
        <button className={`iconbtn sm${showOutline ? ' on' : ''}`} title="Outline" aria-label="Toggle outline" onClick={() => toggleOutline(!showOutline)}><IconList size={16} /></button>
        <button className="iconbtn sm danger-hover" title="Move to Trash" aria-label="Move note to trash" onClick={del}><IconTrash size={16} /></button>
        {confirmDiscard && saving === 'error'
          ? <button className="btn danger sm" onClick={close}>Discard &amp; close</button>
          : <button className="iconbtn sm" title="Close" aria-label="Close note" onClick={close}><IconX size={16} /></button>}
      </div>

      {/* 409 conflict banner: shown instead of the generic error chip.
          Announced via the live region in onState — no conditional role="alert". */}
      {isConflict && (
        <div className="note-conflict-bar">
          <span>This note changed somewhere else.</span>
          <button className="undo-btn" onClick={conflictReload}>Reload</button>
          <button className="undo-btn" onClick={conflictKeepMine}>Keep mine</button>
        </div>
      )}

      {state === 'ready' && (
        <div className="note-edit-meta">
          <label className="note-folder-pick" title="Move to folder">
            <IconFolder size={14} />
            <select
              value={folder}
              onChange={(e) => { const v = e.target.value; if (v === '__new') setFolderPrompt(true); else moveTo(v) }}
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
      <div className="note-edit-body-wrap">
        <div className="note-edit-body" ref={bodyElRef}>
          {state === 'loading' ? <div className="note-loading"><IconSpinner size={20} /></div>
            : state === 'error' ? (
              <div className="note-loading">
                <span>Couldn't load this note.</span>
                <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setLoadTick((t) => t + 1)}>
                  <IconRefresh size={14} /> Retry
                </button>
              </div>
            )
              : (
                <Suspense fallback={<div className="note-loading"><IconSpinner size={20} /></div>}>
                  <NoteRichEditor value={body} onChange={onBody} notes={notes} folder={folder} />
                </Suspense>
              )}
        </div>
        {state === 'ready' && showOutline && <Outline items={outline} onPick={scrollToHeading} onClose={() => toggleOutline(false)} />}
      </div>
      {state === 'ready' && <NoteInfoBar meta={meta} body={body} />}
      {state === 'ready' && <Backlinks path={path} />}
      {folderPrompt && (
        <PromptModal
          title="New folder" placeholder="Folder name" confirmLabel="Move here"
          onSubmit={(name) => { setFolderPrompt(false); moveTo(name) }}
          onCancel={() => setFolderPrompt(false)}
        />
      )}
    </>
  )

  if (inline) return <div className="note-pane">{inner}</div>
  return (
    <ModalFrame overlayClass="note-overlay" modalClass="note-editor" ariaLabel="Note editor" onBackdrop={close}>
      {inner}
    </ModalFrame>
  )
}
