import React from 'react'
import { createPortal } from 'react-dom'

// Shared modal scaffolding: a full-screen overlay (mousedown on the backdrop
// closes) wrapping a centered dialog, rendered through a body portal. Used by
// the note editor and the drawing editor.
export default function ModalFrame({ overlayClass = '', modalClass = '', ariaLabel, onBackdrop, children }) {
  return createPortal(
    <div className={`overlay ${overlayClass}`.trim()} onMouseDown={(e) => { if (e.target === e.currentTarget) onBackdrop?.() }}>
      <div className={modalClass} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
