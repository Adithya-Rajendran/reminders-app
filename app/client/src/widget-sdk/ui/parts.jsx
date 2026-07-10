import { useEffect, useMemo } from 'react'
import { IconRefresh, IconInbox } from '../icons.jsx'
import { parseQuickAdd, dueChip, timeLabel, absDate, isRealDate, PRIORITIES } from '../../domain/tasklib.js'
import { announce } from './announcer.jsx'

export function SkeletonRows({ n = 5 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="skel-task" key={i}>
          <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 6, flex: '0 0 auto' }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skel-line" style={{ width: `${60 + (i * 13) % 32}%` }} />
            <div className="skeleton skel-line" style={{ width: `${28 + (i * 17) % 22}%`, marginTop: 7, height: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon = IconInbox, title, sub }) {
  return (
    <div className="state">
      <div className="state-ic"><Icon size={22} /></div>
      <div className="state-title">{title}</div>
      {sub && <div className="state-sub">{sub}</div>}
    </div>
  )
}

export function ErrorState({ sub, onRetry }) {
  return (
    <div className="state error" role="alert">
      <div className="state-ic"><IconRefresh size={22} /></div>
      <div className="state-title">Couldn’t reach your server</div>
      <div className="state-sub">{sub || 'This widget syncs with your own CalDAV / Nextcloud server. Check that it’s reachable and your account in Settings, then retry.'}</div>
      <button className="btn ghost sm" onClick={onRetry} style={{ marginTop: 4 }}><IconRefresh size={14} /> Retry</button>
    </div>
  )
}

// A refresh failed but we still have last-good data: keep the stale list visible
// with a quiet "reconnecting" strip + retry, instead of wiping the widget to the
// full ErrorState card. (Shown only when there ARE tasks; initial-load failure
// still gets the full ErrorState.)
export function ReconnectBanner({ onRetry }) {
  // Announced through the app-level live region (see announcer.jsx) — a
  // conditionally-mounted role="status" node is rarely read by screen readers.
  useEffect(() => { announce('Can’t reach your server — showing the last synced copy.') }, [])
  return (
    <div className="reconnect-banner">
      <span><IconRefresh size={12} /> Can’t reach your server — showing the last synced copy.</span>
      {onRetry && <button type="button" className="undo-btn" onClick={onRetry}>Retry</button>}
    </div>
  )
}

// Transient widget notice: undo (accent), error (danger) or info. The visual
// bar is a plain div; screen-reader announcement goes through the app-level
// LiveAnnouncer so it is actually read (see announcer.jsx).
//   notice = { kind?: 'undo'|'error'|'info', label, action?: { label, fn } }
export function NoticeBar({ notice, dismiss }) {
  // Keyed on the notice OBJECT, not the label: two consecutive notices with an
  // identical label (e.g. two "Completed" undos in the 6s window) must both
  // announce — the announcer's clear-then-set exists exactly for that. Hosts
  // construct a fresh notice object per event, so identity is the event key.
  useEffect(() => { announce(notice.label) }, [notice])
  const kind = notice.kind || 'undo'
  return (
    <div className={`undo-bar${kind === 'error' ? ' notice-error' : ''}`}>
      <span>{notice.label}</span>
      {notice.action?.fn && (
        <button className="undo-btn" onClick={() => { notice.action.fn(); dismiss() }}>{notice.action.label}</button>
      )}
    </div>
  )
}

// Back-compat shell used across every widget: { undo: { label, fn? } }. Kept as
// an adapter so ten call sites don't churn. The notice is memoized on the undo
// object — a fresh literal per render would re-announce on every parent
// re-render now that NoticeBar keys its announce on notice identity.
export function UndoBar({ undo, dismiss }) {
  const notice = useMemo(
    () => ({ kind: 'undo', label: undo.label, action: undo.fn ? { label: 'Undo', fn: undo.fn } : undefined }),
    [undo],
  )
  return <NoticeBar notice={notice} dismiss={dismiss} />
}

// Live, read-only preview of the tokens parseQuickAdd will pull from a quick-add
// line — so the user SEES "tomorrow", "!1", "*work", "after … ->" being
// understood before submitting (recognition over recall; closes the "typed a
// date but the chip still said Today" gap). Renders nothing until something parses.
export function QuickAddPreview({ text }) {
  const p = parseQuickAdd(text || '')
  const chips = []
  if (isRealDate(p.due_date)) {
    const c = dueChip(p.due_date), t = timeLabel(p.due_date)
    chips.push({ k: 'due', cls: `chip qa-chip due ${c?.cls || ''}`, label: `${c?.label || ''}${t ? ` · ${t}` : ''}`, title: absDate(p.due_date) })
  }
  if (p.priority) {
    const pr = PRIORITIES[p.priority]
    chips.push({ k: 'pri', cls: `chip qa-chip pri p${p.priority}`, label: pr ? pr.label : `P${p.priority}`, title: `Priority ${p.priority} — ${pr?.label || ''}` })
  }
  for (const l of (p.labels || [])) chips.push({ k: `lbl-${l}`, cls: 'chip qa-chip lbl', label: `*${l}`, title: `Group / label: ${l}` })
  if (p.cue) chips.push({ k: 'cue', cls: 'chip qa-chip cue', label: `⤳ ${p.cue}`, title: `Cue: ${p.cue}` })
  // Nothing parsed yet but the user IS typing: teach the syntax right where it
  // would take effect (the tokens are invisible until one parses otherwise).
  if (!chips.length) {
    if (!(text || '').trim()) return null
    return <div className="qa-preview qa-preview-hint" aria-live="polite">try “friday 2pm” · !2 · *label</div>
  }
  return (
    <div className="qa-preview" aria-live="polite">
      {chips.map((c) => <span key={c.k} className={c.cls} title={c.title}>{c.label}</span>)}
    </div>
  )
}
