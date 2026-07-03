import { useState } from 'react'
import ModalFrame from './ModalFrame.jsx'
import { useModalRef } from './useModalRef.js'
import { parseQuickAdd } from './tasklib.js'
import { QuickAddPreview } from './widget-sdk/ui/parts.jsx'
import { IconBell, IconPlus, IconSpinner } from './icons.jsx'

// Global quick-capture — a hotkey-opened popup ('c') that drops a thought into the
// Inbox from ANYWHERE, no task widget required (the gap the command palette left).
// Capture is deliberately dumb: it never categorizes. Every captured task is
// created with clarified:false so it lands in the Inbox to be clarified later —
// no due date or alarm unless the natural-language line typed one in.
// onSubmit(fields) creates into the inbox project (resolved by the host).
// The modal opens even before the inbox is known (inboxReady=false: fresh user,
// projects still loading, or no CalDAV account) — a dead 'c' key reads as broken;
// an explanation with a Settings path does not.
export default function QuickCaptureModal({ onSubmit, onClose, inboxReady = true, onOpenSettings }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Chain-capture: when true, a successful submit clears the input and keeps the
  // modal open so several thoughts go in a row (brain-dump). Bound to a "keep
  // open" checkbox AND triggered ad-hoc by a Shift+Enter submit, so the flag is
  // captured per-submit rather than only read from state.
  const [keepOpen, setKeepOpen] = useState(false)
  const ref = useModalRef(onClose)

  const submit = async (e, chain = false) => {
    e.preventDefault()
    const raw = draft.trim()
    if (!raw || busy) return
    if (!inboxReady) {
      setErr('No CalDAV account connected yet — connect one in Settings to start capturing.')
      return
    }
    setBusy(true); setErr('')
    const p = parseQuickAdd(raw)
    try {
      await onSubmit({
        title: p.title || raw,
        priority: p.priority || 0,
        // Captured, not clarified: bare captures belong in the Inbox until the
        // user triages them. This is the ONE field capture always sets.
        clarified: false,
        // Stays uncategorized unless a date was typed; no auto-alarm (add one later
        // when triaging). A dated capture still flows to Upcoming/Calendar too.
        ...(p.due_date ? { due_date: p.due_date } : {}),
        ...(p.labels?.length ? { labels: p.labels } : {}),
        ...(p.cue ? { cue: p.cue } : {}),
        ...(p.cue_trigger ? { cue_trigger: p.cue_trigger } : {}),
      })
      // Chain-capture keeps the modal open with a cleared input; plain submit closes.
      if (chain || keepOpen) {
        setDraft(''); setBusy(false)
      } else {
        onClose()
      }
    } catch (e2) {
      setBusy(false)
      let msg = 'Could not add — check your CalDAV account in Settings.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  return (
    <ModalFrame overlayClass="capture-overlay" modalClass="capture" ariaLabel="Quick capture" onBackdrop={onClose}>
      <div ref={ref} className="capture-inner">
        <form onSubmit={(e) => submit(e, false)}>
          <div className="capture-row">
            <IconBell size={16} />
            <input
              className="capture-input" value={draft} autoFocus aria-label="Capture a task"
              placeholder="Capture a task…  (e.g. “email Sam friday 2pm !2 *work”)"
              onChange={(e) => setDraft(e.target.value)}
              // Shift+Enter chain-submits (keep open, clear input) so a rapid
              // brain-dump doesn't need the mouse; plain Enter submits the form
              // and closes. Handled on the input so it fires before form submit.
              onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) submit(e, true) }}
            />
            <button type="submit" className="iconbtn sm" disabled={busy} aria-label="Add" title="Add">
              {busy ? <IconSpinner size={16} /> : <IconPlus size={16} />}
            </button>
          </div>
          <QuickAddPreview text={draft} />
          <label className="capture-keepopen">
            <input
              type="checkbox" checked={keepOpen} aria-label="Keep open to capture several"
              onChange={(e) => setKeepOpen(e.target.checked)}
            />
            Keep open to capture several
          </label>
          <div className="capture-hint">Added to Inbox — clarify it later. Add a date/time, <b>!1–5</b>, <b>*label</b>, or <b>-&gt; cue</b>. <kbd>Enter</kbd> to add · <kbd>Shift+Enter</kbd> to add &amp; keep going · <kbd>Esc</kbd> to close.</div>
          {err && (
            <div role="alert" className="rem-err">
              {err}
              {!inboxReady && onOpenSettings && (
                <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => { onClose(); onOpenSettings() }}>Open Settings</button>
              )}
            </div>
          )}
        </form>
      </div>
    </ModalFrame>
  )
}
