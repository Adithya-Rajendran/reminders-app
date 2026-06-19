import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskList, selectFlowSource, useWidgetSize, atMostW, atLeastW, GroupPicker, SkeletonRows, EmptyState, ErrorState, UndoBar, IconCue } from '../widget-sdk'
import './CuesWidget.css'

// Cues as a mindmap/flowchart: pick a reminder "queue", drag cards onto the board
// to place them, drag the ● handle from one card to another to connect them, and
// click a line to remove it. Each card's position + outgoing links live on the
// VTODO in X-REMINDERS-FLOW (task.flow) — a dedicated field read by no other
// widget. Double-click a card to edit its "when X" cue.
const NODE_W = 188
const NODE_H = 64
const CONTENT_W = 2400
const CONTENT_H = 1400
const edgePath = (sx, sy, tx, ty) => `M ${sx} ${sy} C ${sx + 55} ${sy}, ${tx - 55} ${ty}, ${tx} ${ty}`

function FlowNode({ task, pos, dragging, onMoveStart, onLinkStart, onToggle, onUnplace, onSetCue }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(task.cue || '')
  const cue = (task.cue || '').trim()
  const stop = (e) => e.stopPropagation()
  const saveCue = () => { onSetCue(task, val.trim()); setEditing(false) }
  return (
    <div className={`flow-node${dragging ? ' dragging' : ''}${task.done ? ' done' : ''}`} data-uid={task.uid} style={{ left: pos.x, top: pos.y, width: NODE_W }} onPointerDown={(e) => onMoveStart(task, e)}>
      <button className={`check-btn${task.done ? ' on' : ''}`} title="Complete" aria-label={`Complete: ${task.title}`} onPointerDown={stop} onClick={() => onToggle(task)} />
      <div className="flow-node-body" onDoubleClick={() => { setVal(task.cue || ''); setEditing(true) }}>
        <div className="flow-node-title" title={task.title}>{task.title}</div>
        {editing ? (
          <input
            className="input flow-cue-input" autoFocus value={val} placeholder="when…"
            onPointerDown={stop}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveCue(); else if (e.key === 'Escape') setEditing(false) }}
            onBlur={saveCue}
          />
        ) : (
          <div className="flow-node-cue">{cue ? <><span className="cue-arrow">→</span> {cue}</> : <span className="flow-cue-add">+ cue</span>}</div>
        )}
      </div>
      <button className="flow-unplace" title="Remove from board" aria-label="Remove from board" onPointerDown={stop} onClick={() => onUnplace(task)}>×</button>
      <span className="flow-handle" title="Drag to link to another card" onPointerDown={(e) => onLinkStart(task, e)} />
    </div>
  )
}

export default function CuesWidget({ tasks: tasksCap, groups, group: initialGroup }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onSetCue, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const [group, setGroup] = useState(initialGroup || '')
  const [knownGroups, setKnownGroups] = useState([])
  const [drag, setDrag] = useState(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const canvasRef = useRef(null)

  // In a narrow column the side queue + the verbose hint crowd out the board, so
  // hide the hint and tuck the queue behind a toolbar toggle (the board itself
  // stays the focus); roomier widths show both inline.
  const sz = useWidgetSize()
  const compact = atMostW(sz, 'sm')
  const showHint = atLeastW(sz, 'md')

  useEffect(() => {
    groups.fetch().then((d) => setKnownGroups((d.groups || []).map((g) => g.name).filter(Boolean))).catch(() => {})
  }, [])

  const source = useMemo(() => selectFlowSource(tasks, group), [tasks, group])
  const draggingMoveUid = drag && drag.mode === 'move' ? drag.uid : null
  const placed = source.filter((t) => t.flow || t.uid === draggingMoveUid)
  const queue = source.filter((t) => !t.flow && t.uid !== draggingMoveUid)
  const placedByUid = new Map(placed.map((t) => [t.uid, t]))
  const posOf = (t) => (draggingMoveUid === t.uid ? { x: drag.x, y: drag.y } : (t.flow || { x: 0, y: 0 }))

  // --- persistence (optimistic store patch + server write) ---
  const persistFlow = useCallback((task, patch) => {
    const cur = task.flow || { x: 0, y: 0, to: [] }
    const flow = {
      x: patch.x != null ? Math.round(patch.x) : cur.x,
      y: patch.y != null ? Math.round(patch.y) : cur.y,
      to: patch.to != null ? patch.to : (cur.to || []),
    }
    tasksCap.patchTask(task.id, { flow })
    tasksCap.update(task.id, { flow }).then(tasksCap.emitChanged).catch(() => load())
  }, [load, tasksCap])
  const unplace = useCallback((task) => {
    tasksCap.patchTask(task.id, { flow: null })
    tasksCap.update(task.id, { flow: null }).then(tasksCap.emitChanged).catch(() => load())
  }, [load, tasksCap])
  const addEdge = useCallback((task, targetUid) => {
    persistFlow(task, { to: [...new Set([...(task.flow?.to || []), targetUid])] })
  }, [persistFlow])
  const removeEdge = useCallback((sourceTask, targetUid) => {
    persistFlow(sourceTask, { to: (sourceTask.flow?.to || []).filter((u) => u !== targetUid) })
  }, [persistFlow])

  // --- pointer drag (reuses the down → window-move → up pattern) ---
  const toContent = (ev) => {
    const c = canvasRef.current; const r = c.getBoundingClientRect()
    return { x: ev.clientX - r.left + c.scrollLeft, y: ev.clientY - r.top + c.scrollTop }
  }
  const targetAt = (ev) => {
    let el = document.elementFromPoint(ev.clientX, ev.clientY)
    while (el && el !== document.body) { if (el.dataset && el.dataset.uid) return el.dataset.uid; el = el.parentElement }
    return null
  }
  const onMoveStart = (task, e, fromQueue = false) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    const s = toContent(e)
    const base = task.flow || { x: Math.max(0, s.x - NODE_W / 2), y: Math.max(0, s.y - 20) }
    const offX = fromQueue ? NODE_W / 2 : s.x - base.x
    const offY = fromQueue ? 20 : s.y - base.y
    setDrag({ mode: 'move', uid: task.uid, x: base.x, y: base.y, offX, offY })
    const move = (ev) => { const p = toContent(ev); setDrag((d) => d && ({ ...d, x: Math.max(0, p.x - d.offX), y: Math.max(0, p.y - d.offY) })) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDrag((d) => { if (d) persistFlow(task, { x: d.x, y: d.y }); return null })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const onLinkStart = (task, e) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const p = posOf(task)
    const sx = p.x + NODE_W, sy = p.y + NODE_H / 2
    setDrag({ mode: 'link', fromUid: task.uid, sx, sy, x: sx, y: sy })
    const move = (ev) => { const c = toContent(ev); setDrag((d) => d && ({ ...d, x: c.x, y: c.y })) }
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      const tgt = targetAt(ev)
      if (tgt && tgt !== task.uid && placedByUid.has(tgt)) addEdge(task, tgt)
      setDrag(null)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const edges = []
  for (const s of placed) {
    for (const tgt of (s.flow?.to || [])) {
      const t = placedByUid.get(tgt)
      if (!t) continue
      const sp = posOf(s), tp = posOf(t)
      edges.push({ key: s.uid + '->' + tgt, from: s, to: tgt, d: edgePath(sp.x + NODE_W, sp.y + NODE_H / 2, tp.x, tp.y + NODE_H / 2) })
    }
  }

  const allGroups = [...knownGroups].sort()
  const recent = groups.recent().filter((g) => allGroups.includes(g))

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (source.length === 0) {
    body = <EmptyState icon={IconCue} title="No reminders to map" sub="Reminders (and cued tasks) in the chosen queue show up here. Add one in the Reminders widget, then drag it onto the board." />
  } else {
    body = (
      <div className="flow-body">
        {(!compact || queueOpen) && (
          <div className="flow-queue">
            <div className="flow-queue-head">Queue · {queue.length}</div>
            {queue.length === 0 && <div className="flow-queue-empty">All placed ✓</div>}
            {queue.map((t) => (
              <button key={t.id} type="button" className="flow-qitem" onPointerDown={(e) => onMoveStart(t, e, true)} title="Drag onto the board">
                <span className="flow-qitem-t">{t.title}</span>
                {(t.cue || '').trim() && <span className="flow-qitem-cue"><span className="cue-arrow">→</span> {t.cue.trim()}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flow-canvas" ref={canvasRef}>
          <div className="flow-content" style={{ width: CONTENT_W, height: CONTENT_H }}>
            <svg className="flow-edges" width={CONTENT_W} height={CONTENT_H}>
              <defs>
                <marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" /></marker>
              </defs>
              {edges.map((e) => (
                <g key={e.key} className="flow-edge" onClick={() => removeEdge(e.from, e.to)}>
                  <path className="flow-edge-hit" d={e.d} />
                  <path className="flow-edge-line" d={e.d} markerEnd="url(#flow-arrow)" />
                </g>
              ))}
              {drag && drag.mode === 'link' && <path className="flow-edge-line temp" d={edgePath(drag.sx, drag.sy, drag.x, drag.y)} markerEnd="url(#flow-arrow)" />}
            </svg>
            {placed.map((t) => (
              <FlowNode
                key={t.id} task={t} pos={posOf(t)} dragging={draggingMoveUid === t.uid}
                onMoveStart={onMoveStart} onLinkStart={onLinkStart} onToggle={onToggle} onUnplace={unplace} onSetCue={onSetCue}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="tasklist flow-wrap">
      <div className="flow-toolbar">
        <GroupPicker value={group} groups={allGroups} recent={recent} onChange={setGroup} onNew={(name) => groups.onNewGroup?.(name)} neutral={{ label: 'All reminders', value: '' }} placeholder="All reminders" />
        {showHint && <span className="flow-hint">Drag a card onto the board · drag ● to link · click a line to remove · double-click to edit the cue</span>}
        {compact && source.length > 0 && (
          <button type="button" className="btn ghost sm" aria-pressed={queueOpen} onClick={() => setQueueOpen((o) => !o)}>
            Queue · {queue.length}
          </button>
        )}
      </div>
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
