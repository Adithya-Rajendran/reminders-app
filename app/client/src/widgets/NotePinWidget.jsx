import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  usePopover, widgetStore, announce, SkeletonRows, EmptyState, ErrorState,
  useWidgetSize, atMostW, atMostH,
  IconNote, IconPin, IconChevDown, IconRefresh, IconLink,
} from '../widget-sdk'
import './NotePinWidget.css'

const PATH_KEY = 'notepin-path'

// A single note, pinned to the board — the "a note beside my tasks" surface, so
// notes stop feeling like a bolted-on second app hidden behind their own view. The
// note's content shows read-only right here (its own scroll); a picker chooses which
// note, and a jump opens the full editor (if a Notes widget is on the board). The
// chosen note is remembered per widget instance. Content is shown as-is (Markdown is
// legible) — this is a glance surface, not the editor.
export default function NotePinWidget({ notes, instanceId }) {
  const sz = useWidgetSize()
  const compact = atMostW(sz, 'sm') || atMostH(sz, 'sm')
  const short = atMostH(sz, 'xs')
  const store = useMemo(() => widgetStore(instanceId), [instanceId])
  const [list, setList] = useState(null) // null = loading | [] | [...]
  const [configured, setConfigured] = useState(true)
  const [pinned, setPinned] = useState(() => store.loadJson(PATH_KEY, null))
  const [note, setNote] = useState(null) // { path, title, body } | null
  const [state, setState] = useState('loading') // 'loading' | 'ready' | 'error' | 'empty'
  const [pickOpen, setPickOpen] = useState(false)
  const pickRef = usePopover(pickOpen, setPickOpen)

  // The note list — for the picker and the most-recent default. Cheap; the server caches it.
  const loadList = useCallback(() => {
    notes.list().then((r) => {
      if (!r || !r.configured) { setConfigured(false); setList([]); return }
      setConfigured(true)
      setList((r.notes || []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))))
    }).catch(() => setList([]))
  }, [notes])
  useEffect(() => { loadList() }, [loadList])

  // Effective note: the pinned choice if it still exists, else the most recently edited.
  const path = useMemo(() => {
    if (!list) return null
    if (pinned && list.some((n) => n.path === pinned)) return pinned
    return list[0]?.path || null
  }, [list, pinned])

  // Fetch the chosen note's body — guarded (the `alive` flag) so a slow response for
  // an OLD path can't overwrite a newer selection when the two get()s resolve out of
  // order (a real WebDAV round-trip). A manual refresh bumps reloadKey to re-run.
  const [reloadKey, setReloadKey] = useState(0)
  const refresh = () => { loadList(); setReloadKey((k) => k + 1) }
  useEffect(() => {
    if (list && !path) { setState('empty'); setNote(null); return undefined }
    if (!path) return undefined
    let alive = true
    setState('loading')
    notes.get(path).then((n) => { if (alive) { setNote(n); setState('ready') } }).catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [notes, path, list, reloadKey])

  const choose = (p) => { setPinned(p); store.saveJson(PATH_KEY, p); setPickOpen(false) }

  if (!configured) {
    return <EmptyState icon={IconNote} title="Notes aren’t connected" sub="Connect Nextcloud in Settings, then pick a note to pin here." />
  }
  if (list && list.length === 0) {
    return <EmptyState icon={IconNote} title="No notes yet" sub="Create a note in the Notes widget, then pin it here to see it beside your tasks." />
  }

  const title = note?.title || (list || []).find((n) => n.path === path)?.title || 'Note'

  return (
    <div className={`notepin${compact ? ' compact' : ''}${short ? ' short' : ''}`}>
      <div className="notepin-head">
        <span className="notepin-title" title={title}><IconPin size={13} /> {title}</span>
        <span className="notepin-actions">
          <span className="inline-ctl" ref={pickRef}>
            <button className="iconbtn sm" aria-label="Choose which note to pin" aria-haspopup="menu" aria-expanded={pickOpen} title="Pick a note" onClick={() => setPickOpen((o) => !o)}>
              <IconChevDown size={15} />
            </button>
            {pickOpen && (
              <div className="mini-menu notepin-pick" role="menu">
                {(list || []).slice(0, 40).map((n) => (
                  <button key={n.path} className={`mini-item${n.path === path ? ' active' : ''}`} role="menuitem" title={n.folder ? `${n.folder} / ${n.title}` : n.title} onClick={() => choose(n.path)}>
                    <IconNote size={13} /> <span className="notepin-pick-t">{n.title}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
          {!short && <button className="iconbtn sm" aria-label="Refresh note" title="Refresh" onClick={refresh}><IconRefresh size={14} /></button>}
          {path && notes.emitOpenNote && (
            // Opening the full editor needs a Notes widget on the board to receive the
            // event; if none is listening, say so rather than doing nothing.
            <button
              className="iconbtn sm" aria-label={`Open ${title} in Notes`} title="Open in Notes"
              onClick={() => {
                if (!notes.hasOpenNoteListener || notes.hasOpenNoteListener()) notes.emitOpenNote(path)
                else announce('Add a Notes widget to this board to open notes in the full editor.')
              }}
            ><IconLink size={14} /></button>
          )}
        </span>
      </div>
      {state === 'loading' && <div className="notepin-body"><SkeletonRows n={4} /></div>}
      {state === 'error' && <ErrorState onRetry={refresh} />}
      {state === 'empty' && <EmptyState icon={IconNote} title="No note selected" sub="Pick a note from the menu above." />}
      {state === 'ready' && (
        note?.body?.trim()
          ? <div className="notepin-body" tabIndex={0}>{note.body}</div>
          : <EmptyState icon={IconNote} title="This note is empty" sub="Open it in Notes to start writing." />
      )}
    </div>
  )
}
