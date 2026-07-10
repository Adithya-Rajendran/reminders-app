import './NotesWidget.css'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useWidgetSize, atMostW, atMostH, atLeastW, atLeastH, usePopover,
  buildTree, folderKids, noteKids, countNotes, canDropInto,
  sortNotes, SORTS, ancestorsOf, pushRecent, pruneRecent,
  widgetStore,
  SkeletonRows, EmptyState, ErrorState, ReconnectBanner, NoticeBar,
  IconNote, IconPlus, IconCloud, IconFolder, IconChevR, IconChevL, IconChevDown, IconSort, IconPin, IconDots, IconTrash, IconSun,
  onNotice,
} from '../widget-sdk'
import { NoteEditor, PromptModal, NoteContextMenu, TrashView } from '../widget-sdk/notes'

const EXPAND_KEY = 'notes-expanded-folders'
const RECENT_KEY = 'notes-recent'

// One note row in the tree / pinned / recent lists. dnd is omitted for the
// pinned/recent virtual sections (those aren't drop sources).
function NoteRow({ n, active, paddingLeft, onOpen, onCtx, dnd }) {
  return (
    <div
      className={`tree-row tree-note${active ? ' active' : ''}`} style={{ paddingLeft }}
      draggable={!!dnd} onDragStart={dnd ? dnd.noteStart(n) : undefined} onDragEnd={dnd ? dnd.end : undefined}
      onDragOver={dnd ? dnd.noteOver : undefined} onDrop={dnd ? dnd.noteDrop : undefined}
      onClick={() => onOpen(n.path)} onContextMenu={(e) => { e.preventDefault(); onCtx(n, e.clientX, e.clientY) }} title={n.title}
    >
      <IconNote size={13} />
      {n.pinned && <IconPin size={11} className="tree-pin-mark" />}
      <span className="tree-name">{n.title}</span>
      {(n.tags || []).slice(0, 2).map((t) => <span key={t} className="note-tag mini">#{t}</span>)}
      <button type="button" className="tree-row-menu" aria-label="Note actions" title="Note actions"
        onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onCtx(n, r.right, r.bottom) }}>
        <IconDots size={14} />
      </button>
    </div>
  )
}

function TreeLevel({ node, depth, sel, active, expanded, onSelect, onToggle, onOpen, onCtx, dnd, sort }) {
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
              <span className="wg-count tree-count">{countNotes(f)}</span>
            </div>
            {isOpen && <TreeLevel node={f} depth={depth + 1} sel={sel} active={active} expanded={expanded} onSelect={onSelect} onToggle={onToggle} onOpen={onOpen} onCtx={onCtx} dnd={dnd} sort={sort} />}
          </Fragment>
        )
      })}
      {noteKids(node, sort).map((n) => (
        <NoteRow key={n.path} n={n} active={active === n.path} paddingLeft={6 + depth * 13 + 16} onOpen={onOpen} onCtx={onCtx} dnd={dnd} />
      ))}
    </>
  )
}

// Notes widget: an Obsidian/VSCode-style workspace — a folder+note tree in a
// sidebar, the selected note open in the main pane. Collapses to a single
// master-detail column when the widget is narrow.
export default function NotesWidget({ notes: notesApi, onOpenSettings, instanceId }) {
  const store = useMemo(() => widgetStore(instanceId), [instanceId])
  const [state, setState] = useState('loading') // loading | ready | error | unconfigured
  const [stale, setStale] = useState(false)     // background refresh failed but we still have data
  const [notes, setNotes] = useState([])
  const [folders, setFolders] = useState([])
  const [sel, setSel] = useState('')      // active folder (where new items go)
  const [expanded, setExpanded] = useState(() => store.loadStringSet(EXPAND_KEY))
  const [q, setQ] = useState('')
  const [tag, setTag] = useState(null)
  const [contentHits, setContentHits] = useState([]) // full-text body matches (server FTS)
  const [openPath, setOpenPath] = useState(null)
  // { path, etag }: set when a widget-side action rewrites the OPEN note
  // server-side (pin from the tree menu) — the editor applies the fresh etag.
  const [extEtag, setExtEtag] = useState(null)
  const [folderPrompt, setFolderPrompt] = useState(false)
  const [sort, setSort] = useState(() => store.loadJson('notes-sort', 'updated'))
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = usePopover(sortOpen, setSortOpen)
  const changeSort = (k) => { setSort(k); store.saveJson('notes-sort', k); setSortOpen(false) }
  const [dragItem, setDragItem] = useState(null) // { type:'note'|'folder', path, folder? }
  const [overTarget, setOverTarget] = useState(null) // destination folder rel path ('' = root) | null
  const [ctxMenu, setCtxMenu] = useState(null) // { note, x, y } | null
  const [renamePrompt, setRenamePrompt] = useState(null) // { path, title } | null
  const [recent, setRecent] = useState(() => store.loadJson(RECENT_KEY, []))
  const [trashOpen, setTrashOpen] = useState(false)
  const [tplOpen, setTplOpen] = useState(false)
  const tplRef = usePopover(tplOpen, setTplOpen)

  // Unified notice slot (replaces the old undo-only `undo` state).
  // Holds ONE notice at a time: undo (accent), error (danger), or info.
  //   notice = { kind: 'undo'|'error'|'info', label, action?: { label, fn } }
  // Undo behavior is identical — the UndoBar was a NoticeBar with kind='undo'.
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  const dismissNotice = useCallback(() => { clearTimeout(noticeTimer.current); setNotice(null) }, [])
  const showNotice = useCallback((n, autoDismissMs = 6000) => {
    clearTimeout(noticeTimer.current)
    setNotice(n)
    if (autoDismissMs > 0) noticeTimer.current = setTimeout(() => setNotice(null), autoDismissMs)
  }, [])
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // NoteEditor / NoteRichEditor emit notices through the notices bus so they
  // can surface errors (image upload failed, drawing save failed) in the
  // widget's notice slot without a prop-drilling chain.
  useEffect(() => onNotice((n) => showNotice(n)), [showNotice])

  // Size class from the shared widget-size system (one observer lives in the
  // frame). Narrow collapses to a single master-detail column; a very wide widget
  // gets a roomier sidebar; a short widget drops the Pinned/Recent shortcuts so
  // the folder tree gets the vertical space.
  const sz = useWidgetSize()
  const narrow = atMostW(sz, 'md')
  const wide = atLeastW(sz, 'xl')
  const showAux = atLeastH(sz, 'sm')
  const compactTools = atMostW(sz, 'sm') || atMostH(sz, 'xs')

  // stateRef lets the load callback read the current state without being listed
  // as a dep (which would recreate load() on every state change and cause loops).
  const stateRef = useRef('loading')
  stateRef.current = state

  const load = useCallback(async () => {
    // On initial / forced load: show skeleton; on background refresh: keep the
    // existing tree visible and set the stale flag only when it fails (never
    // wipe to ErrorState while there is data to show).
    setState((s) => (s === 'ready' ? s : 'loading'))
    try {
      const r = await notesApi.list()
      if (!r.configured) { setState('unconfigured'); return }
      setNotes(Array.isArray(r.notes) ? r.notes : [])
      // Clear stale BEFORE the folders sub-fetch: clearing after it would
      // clobber the catch's setStale(true) (same batched continuation), making
      // a folders-only failure invisible.
      setStale(false)
      // Folders sub-fetch is best-effort — failure folds into the stale flag,
      // not a separate error state, because the tree still shows note paths.
      try { const fr = await notesApi.folders(); setFolders((fr.folders || []).filter(Boolean)) } catch { setStale(true) }
      setState('ready')
    } catch {
      if (stateRef.current === 'ready') {
        // Background refresh failed — keep the existing tree, show the banner.
        setStale(true)
      } else {
        // Initial load failed — show the full ErrorState.
        setState('error')
      }
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Open a note requested from elsewhere (command palette, a [[wikilink]], a
  // backlink). Reload so a just-created note appears, then bring it up.
  useEffect(() => notesApi.onOpenNote((path) => { setOpenPath(path); load() }), [load, notesApi])

  // Keep the open note's folder chain expanded once it's known in the list — so
  // a palette/wikilink jump into a collapsed folder reveals where the note lives.
  useEffect(() => {
    if (!openPath) return
    const n = notes.find((x) => x.path === openPath)
    if (n && n.folder) setExpanded((prev) => new Set([...prev, ...ancestorsOf(n.folder)]))
  }, [openPath, notes])

  // Track recently-opened notes (device-local).
  useEffect(() => {
    if (!openPath) return
    const n = notes.find((x) => x.path === openPath)
    const title = n?.title || openPath.split('/').pop().replace(/\.md$/i, '')
    setRecent((prev) => { const next = pushRecent(prev, { path: openPath, title }); store.saveJson(RECENT_KEY, next); return next })
  }, [openPath, notes])

  // ---- uniform mutation wrapper ----
  // Every mutating action goes through act(label, fn). On failure it shows an
  // error notice with a consistent format; on undo-eligible actions the caller
  // passes a confirmFn. This collapses ~11 separate catch-and-ignore paths into
  // a single auditable pattern so new error cases can't silently regress.
  const act = useCallback((label, fn, { retryFn, onSuccess } = {}) => async (...args) => {
    try {
      const result = await fn(...args)
      onSuccess?.(result)
      return result
    } catch {
      showNotice({
        kind: 'error',
        label: `${label} failed`,
        action: retryFn ? { label: 'Retry', fn: retryFn } : undefined,
      })
    }
  }, [showNotice])

  // ---- per-note actions (context menu) ----
  const openCtx = (note, x, y) => setCtxMenu({ note, x, y })

  const doDuplicate = act('Duplicate', async (n) => {
    const r = await notesApi.duplicate(n.path); await load(); setOpenPath(r.path)
  })

  const doPin = act('Pin', async (n) => {
    const r = await notesApi.setPinned(n.path, !n.pinned)
    // Pinning rewrites the file server-side (new etag). If it's the open note,
    // hand the fresh etag to the editor — otherwise its next autosave sends a
    // stale If-Match and throws a false conflict banner.
    if (r?.etag && n.path === openPath) setExtEtag({ path: n.path, etag: r.etag })
    await load()
  })

  // Move a note to Trash, then offer Undo (restore) — the editor's trash button
  // funnels here too (onDeleted) so both paths share the confirmation bar.
  const doDelete = async (n) => {
    try {
      await notesApi.trash(n.path)
      if (openPath === n.path) setOpenPath(null)
      await load()
      // Undo restore failure surfaces as an error notice with an "Open Trash"
      // action (so the user can still manually restore from the trash view).
      showNotice({
        kind: 'undo',
        label: 'Moved to Trash',
        action: {
          label: 'Undo',
          fn: async () => {
            try { await notesApi.restore(n.path); await load() } catch {
              showNotice({
                kind: 'error',
                label: 'Couldn\'t restore note',
                action: { label: 'Open Trash', fn: () => setTrashOpen(true) },
              })
            }
          },
        },
      })
    } catch {
      showNotice({ kind: 'error', label: 'Move to Trash failed' })
    }
  }

  const submitRename = async (newTitle) => {
    const p = renamePrompt; setRenamePrompt(null)
    try {
      const r = await notesApi.rename(p.path, newTitle)
      if (openPath === p.path && r?.path) setOpenPath(r.path)
      await load()
    } catch {
      showNotice({ kind: 'error', label: 'Rename failed' })
    }
  }

  const toggleExpand = (path) => setExpanded((prev) => {
    const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path)
    store.saveStringSet(EXPAND_KEY, n)
    return n
  })
  const expandAncestors = (path) => setExpanded((prev) => new Set([...prev, ...ancestorsOf(path)]))

  const newNote = act('Create note', async () => {
    const n = await notesApi.create(sel, 'Untitled'); if (sel) expandAncestors(sel); await load(); setOpenPath(n.path)
  })

  // Daily note (Logseq/Obsidian pattern): a frictionless capture surface titled by
  // today's date. Opens the existing one if present (matched by title, any folder),
  // else creates it in the active folder. Low-friction capture is the best-evidenced
  // notes lever (cognitive offloading; Risko & Gilbert 2016).
  const openToday = async () => {
    const d = new Date()
    const title = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const existing = notes.find((n) => n.title === title)
    if (existing) { setOpenPath(existing.path); return }
    try { const n = await notesApi.create(sel, title); if (sel) expandAncestors(sel); await load(); setOpenPath(n.path) } catch {
      showNotice({ kind: 'error', label: 'Couldn\'t create today\'s note' })
    }
  }

  // New note from a template (a note in the Templates folder): duplicate it, then
  // move the copy into the active folder and open it.
  const newFromTemplate = async (tpl) => {
    setTplOpen(false)
    try {
      const dup = await notesApi.duplicate(tpl.path)
      let path = dup.path
      if (sel) { const mv = await notesApi.move(dup.path, sel); path = mv.path; expandAncestors(sel) }
      await load(); setOpenPath(path)
    } catch {
      showNotice({ kind: 'error', label: 'Couldn\'t create note from template' })
    }
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
    } catch {
      showNotice({ kind: 'error', label: 'Move failed' })
    }
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
    try { await notesApi.createFolder(path); expandAncestors(path); setSel(path); await load() } catch {
      showNotice({ kind: 'error', label: 'Couldn\'t create folder' })
    }
  }

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags || []))].sort(), [notes])
  const ql = q.trim().toLowerCase()
  const searching = !!(ql || tag)
  const matches = useMemo(() => notes.filter((n) => (!ql || n.title.toLowerCase().includes(ql) || (n.folder || '').toLowerCase().includes(ql) || (n.tags || []).some((t) => t.toLowerCase().includes(ql))) && (!tag || (n.tags || []).includes(tag))), [notes, ql, tag])

  // Full-text body search (server FTS) runs alongside the instant title filter,
  // debounced; results surface under a "Found in contents" header.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setContentHits([]); return undefined }
    let alive = true
    const t = setTimeout(() => {
      notesApi.search(term).then((r) => { if (alive) setContentHits(Array.isArray(r.results) ? r.results : []) }).catch(() => { if (alive) setContentHits([]) })
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [q])
  // Body hits not already shown as a title match (and respecting the tag filter).
  const bodyHits = useMemo(() => {
    if (!ql) return []
    const titlePaths = new Set(matches.map((m) => m.path))
    const tagOk = (p) => !tag || (notes.find((n) => n.path === p)?.tags || []).includes(tag)
    return contentHits.filter((h) => !titlePaths.has(h.path) && tagOk(h.path))
  }, [contentHits, matches, ql, tag, notes])
  const tree = useMemo(() => buildTree([...new Set([...folders, ...notes.map((n) => n.folder).filter(Boolean)])], notes), [folders, notes])
  const pinnedNotes = useMemo(() => sortNotes(notes.filter((n) => n.pinned), sort), [notes, sort])
  const templates = useMemo(() => notes.filter((n) => n.folder === 'Templates' || (n.folder || '').startsWith('Templates/')), [notes])
  const recentNotes = useMemo(() => {
    const byPath = new Map(notes.map((n) => [n.path, n]))
    return pruneRecent(recent, new Set(byPath.keys())).map((r) => byPath.get(r.path) || r).slice(0, 6)
  }, [recent, notes])

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

  const showSidebar = !narrow || (!openPath && !trashOpen)
  const showMain = !narrow || !!openPath || trashOpen

  return (
    <div className={`notes-widget notes-split${narrow ? ' narrow' : ''}${wide ? ' notes-wide' : ''}`} style={{ position: 'relative' }}>
      {/* Background refresh failed: keep tree visible, show a quiet banner. */}
      {stale && <ReconnectBanner onRetry={load} />}
      {showSidebar && (
        <aside className="notes-sidebar">
          <div className={`note-toolbar${compactTools ? ' compact' : ''}`}>
            <input className="note-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" aria-label="Search notes" />
            {!compactTools && (
              <div className="note-sort" ref={sortRef}>
                <button className="iconbtn sm" aria-label="Sort notes" title="Sort notes" aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((o) => !o)}><IconSort size={15} /></button>
                {sortOpen && (
                  <div className="menu note-sort-menu" role="menu">
                    <div className="menu-label">Sort by</div>
                    {SORTS.map((s) => <button key={s.key} type="button" className={`menu-item${sort === s.key ? ' active' : ''}`} role="menuitem" onClick={() => changeSort(s.key)}>{s.label}</button>)}
                  </div>
                )}
              </div>
            )}
            {!compactTools && <button className="iconbtn sm" aria-label="Today's note" title="Open today's note" onClick={openToday}><IconSun size={15} /></button>}
            {!compactTools && <button className="iconbtn sm" aria-label="New folder" title={sel ? `New folder in ${sel}` : 'New folder'} onClick={() => setFolderPrompt(true)}><IconFolder size={15} /></button>}
            <button className="iconbtn sm" aria-label="New note" title={sel ? `New note in ${sel}` : 'New note'} onClick={newNote}><IconPlus size={16} /></button>
            {!compactTools && templates.length > 0 && (
              <div className="note-tpl" ref={tplRef}>
                <button className="iconbtn sm" aria-label="New from template" title="New from template" aria-haspopup="menu" aria-expanded={tplOpen} onClick={() => setTplOpen((o) => !o)}><IconChevDown size={14} /></button>
                {tplOpen && (
                  <div className="menu note-tpl-menu" role="menu">
                    <div className="menu-label">New from template</div>
                    {templates.map((t) => <button key={t.path} type="button" className="menu-item" role="menuitem" onClick={() => newFromTemplate(t)}>{t.title}</button>)}
                  </div>
                )}
              </div>
            )}
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
                ? (
                  <>
                    {/* A live tag filter silently narrows search results — say so,
                        with a one-click way out, or "no matches" reads as "the
                        note doesn't exist". */}
                    {tag && ql && (
                      <div className="note-search-scope">
                        Searching within <strong>#{tag}</strong>
                        <button type="button" className="undo-btn" onClick={() => setTag(null)}>Search all notes</button>
                      </div>
                    )}
                    {sortNotes(matches, sort).map((n) => (
                      <div
                        key={n.path} className={`tree-row tree-note${openPath === n.path ? ' active' : ''}`} style={{ paddingLeft: 8 }}
                        draggable onDragStart={dnd.noteStart(n)} onDragEnd={dnd.end}
                        onDragOver={dnd.noteOver} onDrop={dnd.noteDrop}
                        onClick={() => setOpenPath(n.path)} onContextMenu={(e) => { e.preventDefault(); openCtx(n, e.clientX, e.clientY) }} title={n.title}
                      >
                        <IconNote size={13} />
                        {n.pinned && <IconPin size={11} className="tree-pin-mark" />}
                        <span className="tree-name">{n.title}</span>
                        {n.folder && <span className="tree-note-folder">{n.folder}</span>}
                      </div>
                    ))}
                    {bodyHits.length > 0 && (
                      <>
                        <div className="note-search-head">Found in contents</div>
                        {bodyHits.map((h) => (
                          <div
                            key={h.path} className={`tree-row tree-note note-hit${openPath === h.path ? ' active' : ''}`} style={{ paddingLeft: 8 }}
                            onClick={() => setOpenPath(h.path)} title={h.title}
                          >
                            <IconNote size={13} />
                            <div className="note-hit-main">
                              <span className="tree-name">{h.title}</span>
                              <span className="note-hit-snip">{(h.snippet || []).map((s, i) => (s.hit ? <mark key={i}>{s.t}</mark> : <span key={i}>{s.t}</span>))}</span>
                            </div>
                            {h.folder && <span className="tree-note-folder">{h.folder}</span>}
                          </div>
                        ))}
                      </>
                    )}
                    {matches.length === 0 && bodyHits.length === 0 && <div className="note-empty-q">No matching notes.</div>}
                  </>
                )
                : (
                  <>
                    {showAux && pinnedNotes.length > 0 && (
                      <div className="tree-section">
                        <div className="wg-eyebrow tree-head"><IconPin size={11} /> Pinned</div>
                        {pinnedNotes.map((n) => <NoteRow key={'pin:' + n.path} n={n} active={openPath === n.path} paddingLeft={8} onOpen={setOpenPath} onCtx={openCtx} />)}
                      </div>
                    )}
                    {showAux && recentNotes.length > 0 && (
                      <div className="tree-section">
                        <div className="wg-eyebrow tree-head">Recent</div>
                        {recentNotes.map((n) => <NoteRow key={'rec:' + n.path} n={n} active={openPath === n.path} paddingLeft={8} onOpen={setOpenPath} onCtx={openCtx} />)}
                      </div>
                    )}
                    <TreeLevel node={tree} depth={0} sel={sel} active={openPath} expanded={expanded} onSelect={setSel} onToggle={toggleExpand} onOpen={setOpenPath} onCtx={openCtx} dnd={dnd} sort={sort} />
                  </>
                )}
          </div>
          <button className={`notes-trash-btn${trashOpen ? ' on' : ''}`} onClick={() => setTrashOpen(true)} title="Trash"><IconTrash size={14} /> Trash</button>
        </aside>
      )}
      {showMain && (
        <main className="notes-main">
          {narrow && openPath && !trashOpen && (
            <button className="notes-back" onClick={() => setOpenPath(null)}><IconChevL size={15} /> Files</button>
          )}
          {trashOpen
            ? (
              <TrashView
                onClose={() => setTrashOpen(false)} onChanged={load}
                // Restoring shouldn't strand the user in a now-emptier trash:
                // confirm it happened and offer a one-click way to the note.
                onRestored={(r) => showNotice({
                  kind: 'info',
                  label: `Restored “${r?.title || 'note'}”`,
                  action: r?.path ? { label: 'Open', fn: () => { setTrashOpen(false); setOpenPath(r.path) } } : undefined,
                })}
              />
            )
            : openPath
              ? (
                <NoteEditor
                  inline path={openPath} notes={notes} extEtag={extEtag}
                  onClose={() => setOpenPath(null)}
                  onChanged={(np) => { if (np) setOpenPath(np); load() }}
                  // The editor's trash button funnels through the widget's notice
                  // bar (same as a context-menu delete) — it passes the trashed
                  // path so Undo can restore it.
                  onDeleted={(p) => {
                    const path = p || openPath
                    setOpenPath(null); load()
                    if (path) {
                      showNotice({
                        kind: 'undo',
                        label: 'Moved to Trash',
                        action: {
                          label: 'Undo',
                          fn: async () => {
                            try { await notesApi.restore(path); await load() } catch {
                              showNotice({
                                kind: 'error',
                                label: 'Couldn\'t restore note',
                                action: { label: 'Open Trash', fn: () => setTrashOpen(true) },
                              })
                            }
                          },
                        },
                      })
                    }
                  }}
                />
              )
              : (
                <div className="wg-empty notes-main-empty">
                  <div className="wg-empty-icon"><IconNote size={22} /></div>
                  <div className="wg-empty-title">Select a note</div>
                  <div className="wg-empty-sub">Pick one from the tree, search, or jump with <kbd>Ctrl</kbd>+<kbd>O</kbd>.</div>
                  <button className="btn primary sm" style={{ marginTop: 10 }} onClick={newNote}><IconPlus size={14} /> New note</button>
                </div>
              )}
        </main>
      )}
      {folderPrompt && (
        <PromptModal
          title="New folder" label={sel ? `Inside "${sel}"` : 'In Notes (root)'} placeholder="Folder name"
          onSubmit={createFolder} onCancel={() => setFolderPrompt(false)}
        />
      )}
      {renamePrompt && (
        <PromptModal
          title="Rename note" initialValue={renamePrompt.title} placeholder="Note title" confirmLabel="Rename"
          onSubmit={submitRename} onCancel={() => setRenamePrompt(null)}
        />
      )}
      {ctxMenu && (
        <NoteContextMenu
          note={ctxMenu.note} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}
          onRename={() => setRenamePrompt({ path: ctxMenu.note.path, title: ctxMenu.note.title })}
          onDuplicate={() => doDuplicate(ctxMenu.note)}
          onPin={() => doPin(ctxMenu.note)}
          onDelete={() => doDelete(ctxMenu.note)}
        />
      )}
      {notice && (
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 10, zIndex: 5 }}>
          <NoticeBar notice={notice} dismiss={dismissNotice} />
        </div>
      )}
    </div>
  )
}
