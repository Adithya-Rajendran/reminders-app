import { IconRefresh, IconInbox } from '../../icons.jsx'
import { parseQuickAdd, dueChip, timeLabel, absDate, isRealDate, PRIORITIES } from '../../tasklib.js'

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

export function UndoBar({ undo, dismiss }) {
  return (
    <div className="undo-bar" role="status">
      <span>{undo.label}</span>
      {undo.fn && <button className="undo-btn" onClick={() => { undo.fn(); dismiss() }}>Undo</button>}
    </div>
  )
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
    chips.push({ k: 'due', cls: `qa-chip due ${c?.cls || ''}`, label: `${c?.label || ''}${t ? ` · ${t}` : ''}`, title: absDate(p.due_date) })
  }
  if (p.priority) {
    const pr = PRIORITIES[p.priority]
    chips.push({ k: 'pri', cls: `qa-chip pri p${p.priority}`, label: pr ? pr.label : `P${p.priority}`, title: `Priority ${p.priority} — ${pr?.label || ''}` })
  }
  for (const l of (p.labels || [])) chips.push({ k: `lbl-${l}`, cls: 'qa-chip lbl', label: `*${l}`, title: `Group / label: ${l}` })
  if (p.cue) chips.push({ k: 'cue', cls: 'qa-chip cue', label: `⤳ ${p.cue}`, title: `Cue: ${p.cue}` })
  if (!chips.length) return null
  return (
    <div className="qa-preview" aria-live="polite">
      {chips.map((c) => <span key={c.k} className={c.cls} title={c.title}>{c.label}</span>)}
    </div>
  )
}
