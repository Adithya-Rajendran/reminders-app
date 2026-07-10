import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  // The pinned note is a fixed-height index card, not an editor — long notes get
  // cut off at the fold. overflow-y:auto lets a mouse/keyboard/touch user scroll
  // to see the rest, but nothing else hints that; a headless/overlay scrollbar
  // (or one that's just visually subtle against the paper surface) leaves the cut
  // reading as a hard clip mid-sentence instead of an intentional "there's more".
  // Track whether the scrolled-to position still has content below the fold so
  // the CSS can fade the last lines into the paper instead (see .notepin-fade).
  const bodyRef = useRef(null)
  const [moreBelow, setMoreBelow] = useState(false)
  const checkOverflow = useCallback(() => {
    const el = bodyRef.current
    setMoreBelow(!!el && el.scrollHeight - el.clientHeight - el.scrollTop > 1)
  }, [])
  const hasBody = state === 'ready' && !!note?.body?.trim()
  useEffect(() => {
    if (!hasBody) { setMoreBelow(false); return undefined }
    checkOverflow()
    const el = bodyRef.current
    // jsdom (component tests) has no ResizeObserver — degrades to the one-shot
    // check above, same guard useElementSize uses for the same reason.
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(checkOverflow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasBody, note, checkOverflow])

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
      {state === 'loading' && <div className="notepin-skel"><SkeletonRows n={4} /></div>}
      {state === 'error' && <ErrorState onRetry={refresh} />}
      {state === 'empty' && <EmptyState icon={IconNote} title="No note selected" sub="Pick a note from the menu above." />}
      {state === 'ready' && (
        hasBody
          ? (
            <div className="notepin-scroll">
              <div className="notepin-body" ref={bodyRef} tabIndex={0} onScroll={checkOverflow}>
                <div className="notepin-prose">{note.body}</div>
              </div>
              <div className={`notepin-fade${moreBelow ? '' : ' hide'}`} aria-hidden="true" />
            </div>
          )
          : <EmptyState icon={IconNote} title="This note is empty" sub="Open it in Notes to start writing." />
      )}
    </div>
  )
}
