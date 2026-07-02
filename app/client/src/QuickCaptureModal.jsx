import { useState } from 'react'
import ModalFrame from './ModalFrame.jsx'
import { useModalRef } from './useModalRef.js'
import { parseQuickAdd } from './tasklib.js'
import { QuickAddPreview } from './widget-sdk/ui/parts.jsx'
import { IconBell, IconPlus, IconSpinner } from './icons.jsx'

// Global quick-capture — a hotkey-opened popup ('c') that drops a thought into the
// inbox from ANYWHERE, no task widget required (the gap the command palette left).
// Uncategorized by default: no due date or alarm unless the natural-language line
// includes a date/time, so a bare capture lands in Triage to be processed later.
// onSubmit(fields) creates into the inbox project (resolved by the host).
// The modal opens even before the inbox is known (inboxReady=false: fresh user,
// projects still loading, or no CalDAV account) — a dead 'c' key reads as broken;
// an explanation with a Settings path does not.
export default function QuickCaptureModal({ onSubmit, onClose, inboxReady = true, onOpenSettings }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useModalRef(onClose)

  const submit = async (e) => {
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
        // Stays uncategorized unless a date was typed; no auto-alarm (add one later
        // when triaging). A dated capture still flows to Upcoming/Calendar too.
        ...(p.due_date ? { due_date: p.due_date } : {}),
        ...(p.labels?.length ? { labels: p.labels } : {}),
        ...(p.cue ? { cue: p.cue } : {}),
        ...(p.cue_trigger ? { cue_trigger: p.cue_trigger } : {}),
      })
      onClose()
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
        <form onSubmit={submit}>
          <div className="capture-row">
            <IconBell size={16} />
            <input
              className="capture-input" value={draft} autoFocus aria-label="Capture a task"
              placeholder="Capture a task…  (e.g. “email Sam friday 2pm !2 *work”)"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="iconbtn sm" disabled={busy} aria-label="Add" title="Add">
              {busy ? <IconSpinner size={16} /> : <IconPlus size={16} />}
            </button>
          </div>
          <QuickAddPreview text={draft} />
          <div className="capture-hint">Uncategorized → lands in Triage. Add a date/time, <b>!1–5</b>, <b>*label</b>, or <b>-&gt; cue</b>. <kbd>Enter</kbd> to add · <kbd>Esc</kbd> to close.</div>
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
