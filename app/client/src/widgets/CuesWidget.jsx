import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTaskList, selectFlowSource, cueTriggerOf, useWidgetSize, atMostW, atLeastW, GroupPicker, SkeletonRows, EmptyState, ErrorState, ReconnectBanner, UndoBar, IconCue, NODE_W, CONTENT_W, CONTENT_H, edgePath, toContent, nodeOut, edgeBetween, dropBase, dragTo, canvasExtent, uidFromPoint } from '../widget-sdk'
import './CuesWidget.css'

// Cues as a mindmap/flowchart: pick a reminder "queue", drag cards onto the board
// to place them, drag the ● handle from one card to another to connect them, and
// click a line to remove it. Each card's position + outgoing links live on the
// VTODO in X-REMINDERS-FLOW (task.flow) — a dedicated field read by no other
// widget. Double-click a card to edit its "when X" cue.
// The board geometry (node size, content plane, pointer→content transform, edge
// anchors + path) lives in ../flowgeom.js so it's node-testable without a DOM.

function FlowNode({ task, pos, dragging, linkArmed, onMoveStart, onLinkStart, onLinkKey, onToggle, onUnplace, onSetCue }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(task.cue || '')
  const cue = (task.cue || '').trim()
  const stop = (e) => e.stopPropagation()
  const saveCue = () => { onSetCue(task, val.trim()); setEditing(false) }
  return (
    <div className={`flow-node${dragging ? ' dragging' : ''}${task.done ? ' done' : ''}${linkArmed ? ' link-armed' : ''}`} data-uid={task.uid} style={{ left: pos.x, top: pos.y, width: NODE_W }} onPointerDown={(e) => onMoveStart(task, e)}>
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
      <button type="button" className="flow-edit" title="Edit cue" aria-label={`Edit cue: ${task.title}`} onPointerDown={stop} onClick={() => { setVal(task.cue || ''); setEditing(true) }}>✎</button>
      <button className="flow-unplace" title="Remove from board" aria-label="Remove from board" onPointerDown={stop} onClick={() => onUnplace(task)}>×</button>
      {/* Pointer-drag from this handle creates a link; it's a real <button> so it's
          tab-focusable and announced. Keyboard users start the same link gesture
          with Enter/Space, then pick a target card with another Enter. */}
      <button
        type="button" className="flow-handle"
        title={linkArmed ? 'Press Enter on another card to finish the link (Esc to cancel)' : 'Drag (or press Enter) to link to another card'}
        aria-label="Link to another card" aria-pressed={linkArmed}
        onPointerDown={(e) => onLinkStart(task, e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLinkKey(task) } else if (e.key === 'Escape' && linkArmed) { e.preventDefault(); onLinkKey(null) } }}
      />
    </div>
  )
}

export default function CuesWidget({ tasks: tasksCap, groups, group: initialGroup }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onPatch, undo, dismissUndo } = useTaskList(tasksCap, selector)
  // Editing a cue here also derives its typed trigger (time/location/after) so the
  // cue is contextually usable elsewhere (e.g. the Focus widget) — see cueTriggerOf.
  const setCue = useCallback((task, text) => {
    onPatch(task, { cue: text, cue_trigger: text ? cueTriggerOf(text) : null })
  }, [onPatch])
  const [group, setGroup] = useState(initialGroup || '')
  const [knownGroups, setKnownGroups] = useState([])
  const [drag, setDrag] = useState(null)
  // Keyboard equivalent of the drag-to-link gesture: the first Enter "arms" a
  // source card, the second Enter on a different card completes the edge. Pointer
  // drag is untouched; this only adds a no-mouse path.
  const [linkArm, setLinkArm] = useState(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const canvasRef = useRef(null)

  // In a narrow column the side queue + the verbose hint crowd out the board, so
  // hide the hint and tuck the queue behind a toolbar toggle (the board itself
  // stays the focus); roomier widths show both inline.
  const sz = useWidgetSize()
  const compact = atMostW(sz, 'sm')
  const compactBoard = sz.width > 0 && sz.width < 760
  const showHint = atLeastW(sz, 'md')

  useEffect(() => {
    groups.fetch().then((d) => setKnownGroups((d.groups || []).map((g) => g.name).filter(Boolean))).catch(() => {})
  }, [])

  const source = useMemo(() => selectFlowSource(tasks, group), [tasks, group])

  // Effective canvas: the constant floor, grown with the measured widget (a
  // bigger widget deserves more board) and never smaller than the placed nodes'
  // extents — otherwise shrinking the widget after parking a card far right/down
  // would strand it beyond the scrollable plane. Positions are absolute px, so
  // resizing the plane never moves existing cards.
  const { w: effectiveW, h: effectiveH } = useMemo(
    () => canvasExtent(source.map((t) => t.flow), CONTENT_W, CONTENT_H, sz.width, sz.height),
    [source, sz.width, sz.height],
  )
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
  // Reads live rect/scroll off the canvas and defers the math to flowgeom.toContent.
  const ptToContent = (ev) => {
    const c = canvasRef.current
    return toContent(c.getBoundingClientRect(), c.scrollLeft, c.scrollTop, ev.clientX, ev.clientY)
  }
  const targetAt = (ev) => uidFromPoint(document.elementFromPoint(ev.clientX, ev.clientY))
  const onMoveStart = (task, e, fromQueue = false) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    const s = ptToContent(e)
    const base = task.flow || dropBase(s, effectiveW, effectiveH)
    const offX = fromQueue ? NODE_W / 2 : s.x - base.x
    const offY = fromQueue ? 20 : s.y - base.y
    setDrag({ mode: 'move', uid: task.uid, x: base.x, y: base.y, offX, offY })
    const move = (ev) => { const p = ptToContent(ev); setDrag((d) => d && ({ ...d, ...dragTo(p, d.offX, d.offY, effectiveW, effectiveH) })) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDrag((d) => { if (d) persistFlow(task, { x: d.x, y: d.y }); return null })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const onLinkStart = (task, e) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const { x: sx, y: sy } = nodeOut(posOf(task))
    setDrag({ mode: 'link', fromUid: task.uid, sx, sy, x: sx, y: sy })
    const move = (ev) => { const c = ptToContent(ev); setDrag((d) => d && ({ ...d, x: c.x, y: c.y })) }
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      const tgt = targetAt(ev)
      if (tgt && tgt !== task.uid && placedByUid.has(tgt)) addEdge(task, tgt)
      setDrag(null)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  // Two-step keyboard link: arm on first card, complete (or re-arm) on the next.
  // Passing null cancels. Mirrors the drag's "same/missing target = no-op" rule.
  const onLinkKey = (task) => {
    if (!task) { setLinkArm(null); return }
    if (!linkArm) { setLinkArm(task.uid); return }
    if (linkArm !== task.uid && placedByUid.has(task.uid)) {
      const src = placedByUid.get(linkArm)
      if (src) addEdge(src, task.uid)
    }
    setLinkArm(null)
  }

  const edges = []
  for (const s of placed) {
    for (const tgt of (s.flow?.to || [])) {
      const t = placedByUid.get(tgt)
      if (!t) continue
      edges.push({ key: s.uid + '->' + tgt, from: s, to: tgt, d: edgeBetween(posOf(s), posOf(t)) })
    }
  }

  const allGroups = [...knownGroups].sort()
  const recent = groups.recent().filter((g) => allGroups.includes(g))

  // A refresh failure with an already-loaded board keeps the queue/canvas
  // visible (a ReconnectBanner is rendered alongside the toolbar below) instead
  // of blanking to ErrorState — only a never-loaded failure does that.
  const hasData = source.length > 0
  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error' && !hasData) body = <ErrorState onRetry={load} />
  else if (!hasData) {
    body = <EmptyState icon={IconCue} title="No reminders to map" sub="Reminders (and cued tasks) in the chosen queue show up here. Add one in the Reminders widget, then drag it onto the board." />
  } else if (compactBoard) {
    body = (
      <div className="flow-compact-list">
        <div className="flow-compact-sec">
          <div className="wg-eyebrow flow-queue-head">Placed · {placed.length}</div>
          {placed.length === 0 && <div className="flow-queue-empty">Drag cards onto the board when there is more room.</div>}
          {placed.map((t) => (
            <div key={t.id} className="flow-compact-card">
              <button className={`check-btn${t.done ? ' on' : ''}`} title="Complete" aria-label={`Complete: ${t.title}`} onClick={() => onToggle(t)} />
              <div className="flow-compact-main">
                <div className="flow-compact-title">{t.title}</div>
                {(t.cue || '').trim() && <div className="flow-compact-cue"><span className="cue-arrow">→</span> {t.cue.trim()}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="flow-compact-sec">
          <div className="wg-eyebrow flow-queue-head">Queue · {queue.length}</div>
          {queue.length === 0 && <div className="flow-queue-empty">All placed ✓</div>}
          {queue.map((t) => (
            <button key={t.id} type="button" className="flow-qitem" onPointerDown={(e) => onMoveStart(t, e, true)} title="Drag onto the board">
              <span className="flow-qitem-t">{t.title}</span>
              {(t.cue || '').trim() && <span className="flow-qitem-cue"><span className="cue-arrow">→</span> {t.cue.trim()}</span>}
            </button>
          ))}
        </div>
      </div>
    )
  } else {
    body = (
      <div className="flow-body">
        {(!compact || queueOpen) && (
          <div className="flow-queue">
            <div className="wg-eyebrow flow-queue-head">Queue · {queue.length}</div>
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
          <div className="flow-content" style={{ width: effectiveW, height: effectiveH }}>
            <svg className="flow-edges" width={effectiveW} height={effectiveH}>
              <defs>
                <marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" /></marker>
              </defs>
              {edges.map((e) => (
                <g
                  key={e.key} className="flow-edge" tabIndex={0} role="button" aria-label="Remove link"
                  onClick={() => removeEdge(e.from, e.to)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeEdge(e.from, e.to) } }}
                >
                  <path className="flow-edge-hit" d={e.d} />
                  <path className="flow-edge-line" d={e.d} markerEnd="url(#flow-arrow)" />
                </g>
              ))}
              {drag && drag.mode === 'link' && <path className="flow-edge-line temp" d={edgePath(drag.sx, drag.sy, drag.x, drag.y)} markerEnd="url(#flow-arrow)" />}
            </svg>
            {placed.map((t) => (
              <FlowNode
                key={t.id} task={t} pos={posOf(t)} dragging={draggingMoveUid === t.uid} linkArmed={linkArm === t.uid}
                onMoveStart={onMoveStart} onLinkStart={onLinkStart} onLinkKey={onLinkKey} onToggle={onToggle} onUnplace={unplace} onSetCue={setCue}
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
        {/* Three beats, not a paragraph — cue editing already has a visible ✎
            affordance on every card, so the legend only teaches the gestures
            that have no on-card control. Hidden while there is nothing to
            drag: the empty state already explains where cards come from. */}
        {showHint && hasData && <span className="wg-footnote flow-hint">Drag to place · drag ● to link · click a line to unlink</span>}
        {compact && source.length > 0 && (
          <button type="button" className="btn ghost sm" aria-pressed={queueOpen} onClick={() => setQueueOpen((o) => !o)}>
            Queue · {queue.length}
          </button>
        )}
      </div>
      {state === 'error' && hasData && <ReconnectBanner onRetry={load} />}
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
