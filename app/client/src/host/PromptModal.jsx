import { useState } from 'react'
import ModalFrame from './ModalFrame.jsx'
import { useModalRef } from '../widget-sdk/useModalRef.js'

// A small themed replacement for window.prompt: one text input in a centered
// dialog. Controlled by the parent — render it when you need input; you get the
// trimmed value via onSubmit, or onCancel for Esc / Cancel / backdrop.
export default function PromptModal({ title, label, placeholder = '', initialValue = '', confirmLabel = 'Create', onSubmit, onCancel }) {
  const [val, setVal] = useState(initialValue)
  // Focus the input on open, trap Tab, close on Esc, restore focus on close.
  const ref = useModalRef(() => onCancel?.())
  const submit = (e) => { e?.preventDefault(); const v = val.trim(); if (v) onSubmit?.(v) }
  return (
    <ModalFrame overlayClass="prompt-overlay" modalClass="prompt-modal" ariaLabel={title} onBackdrop={onCancel}>
      <form ref={ref} onSubmit={submit}>
        <div className="prompt-title">{title}</div>
        {label && <div className="prompt-label">{label}</div>}
        <input className="input prompt-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder} aria-label={title} />
        <div className="prompt-actions">
          <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary sm" disabled={!val.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </ModalFrame>
  )
}
