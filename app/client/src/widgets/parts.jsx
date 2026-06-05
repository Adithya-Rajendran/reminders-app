import React from 'react'
import { IconRefresh, IconInbox } from '../icons.jsx'

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
      <div className="state-title">Couldn’t load</div>
      <div className="state-sub">{sub || 'The request failed. Check your connection and try again.'}</div>
      <button className="btn ghost sm" onClick={onRetry} style={{ marginTop: 4 }}><IconRefresh size={14} /> Retry</button>
    </div>
  )
}

export function UndoBar({ undo, dismiss }) {
  return (
    <div className="undo-bar" role="status">
      <span>{undo.label}</span>
      {undo.fn && <button className="undo-btn" onClick={() => { undo.fn(); dismiss() }}>Undo</button>}
    </div>
  )
}
