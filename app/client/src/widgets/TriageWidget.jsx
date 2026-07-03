import { useCallback, useMemo, useState } from 'react'
import {
  useTaskList, useWidgetSize, atLeastW, atLeastH,
  groupEisenhower, byImportanceThenDue, isRealDate,
  TaskRow, EmptyState, ErrorState, SkeletonRows, UndoBar,
  IconTarget, IconCheck,
} from '../widget-sdk'
import './TriageWidget.css'

// The PRIORITIZE surface: an Eisenhower matrix you decide *in*. No points, no
// levels, no streaks, no confetti — just the four quadrants (by the explicit
// task.important flag × due-proximity urgency) with actionable rows, plus a
// "Most important" callout naming the single task to do now. Gamification is
// retired: this is a calm decision board, not a slot machine.
const QUADS = [
  { k: 'Q1', label: 'Do first', sub: 'important · urgent' },
  { k: 'Q2', label: 'Schedule', sub: 'important' },
  { k: 'Q3', label: 'Delegate', sub: 'urgent' },
  { k: 'Q4', label: 'Later', sub: 'neither' },
]

// The two importance-setting quadrants (Q1/Q2 = important, Q3/Q4 = not). Dragging
// a task INTO a quadrant is the user asserting both axes at once, so a drop must
// persist the importance flip AND, for the urgent column (Q1/Q3), give the task a
// concrete "now" so it actually reads as urgent instead of silently snapping back.
const IMPORTANT_QUAD = { Q1: true, Q2: true, Q3: false, Q4: false }
const URGENT_QUAD = { Q1: true, Q3: true, Q2: false, Q4: false }

// A due instant that is unambiguously "urgent" (inside the 48h window
// eisenhowerQuadrant uses) without being overdue: end of today, local time. Kept
// deliberately simple — the drop asserts urgency, the exact minute doesn't matter.
function soonDue() {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

export default function TriageWidget({ tasks: tasksCap }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onSchedule, onSetPriority, onPatch, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const sz = useWidgetSize()

  const wide = atLeastW(sz, 'lg')
  const showWhy = atLeastH(sz, 'sm')

  // Which quadrant is under a drag right now — only for the drop-target highlight.
  const [dragOver, setDragOver] = useState(null)

  const quads = useMemo(() => groupEisenhower(tasks, new Date()), [tasks])

  // "Most important" = the single task to do now: the top of the important+urgent
  // pile, else the top important-but-not-urgent one. byImportanceThenDue orders by
  // priority then nearest due within a quadrant. No frog/dread/points framing — it
  // is simply the most pressing important thing.
  const mostImportant = useMemo(() => {
    const pool = quads.Q1.length ? quads.Q1 : quads.Q2
    return pool.slice().sort(byImportanceThenDue)[0] || null
  }, [quads])

  // Persist a drag between quadrants. onDragStart stashes the task id; the target
  // quadrant flips task.important to match its column (Q1/Q2 → true, Q3/Q4 →
  // false) and, if it's an urgent column and the task isn't already urgent-dated,
  // nudges the due date to "soon" so it lands where it was dropped. A task already
  // in the right quadrant is a no-op (no needless PATCH).
  const onDropInto = useCallback((quadKey, e) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    const task = tasks.find((t) => String(t.id) === id)
    if (!task) return
    const important = IMPORTANT_QUAD[quadKey]
    const patch = {}
    if (!!task.important !== important) patch.important = important
    // Only the urgent columns assert a schedule, and only when the task isn't
    // already urgently dated — we never *remove* a due date (Q2/Q4 leave it be),
    // so dropping into "Later" won't wipe a real deadline the user set on purpose.
    if (URGENT_QUAD[quadKey] && !isRealDate(task.due_date)) patch.due_date = soonDue()
    if (Object.keys(patch).length) onPatch(task, patch)
  }, [tasks, onPatch])

  if (state === 'loading') return <div className="tasklist"><SkeletonRows n={4} /></div>
  if (state === 'error') return <div className="tasklist"><ErrorState onRetry={load} /></div>

  const rowCap = wide ? 12 : 8

  return (
    <div className="triage">
      {/* Most important callout — the one task to do now (no points). */}
      {mostImportant ? (
        <div className="tri-focus">
          <div className="tri-focus-eyebrow"><IconTarget size={14} /> Most important</div>
          <button className="tri-focus-check" aria-label={`Complete: ${mostImportant.title}`} onClick={() => onToggle(mostImportant)}>
            <IconCheck size={16} />
          </button>
          <div className="tri-focus-body">
            <div className="tri-focus-title">{mostImportant.title}</div>
            {showWhy && <div className="tri-focus-why">Your most important task right now — do this before easier, busier work.</div>}
          </div>
        </div>
      ) : (
        <EmptyState icon={IconTarget} title="Nothing flagged" sub="Mark a task important (or drag one into a top row) to set your focus." />
      )}

      {/* Eisenhower matrix — droppable quadrants; dragging a task persists its axes. */}
      <div className="eisen">
        {QUADS.map((q) => (
          <div
            className={`eq eq-${q.k}${dragOver === q.k ? ' drop-over' : ''}`}
            key={q.k}
            onDragOver={(e) => { e.preventDefault(); setDragOver(q.k) }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(null) }}
            onDrop={(e) => onDropInto(q.k, e)}
          >
            <div className="eq-head"><span className="eq-label">{q.label}</span><span className="eq-count">{quads[q.k].length}</span></div>
            {wide && <div className="eq-sub">{q.sub}</div>}
            <div className="eq-list">
              {/* Real (dense) TaskRows: the matrix is where you DECIDE, so complete/
                  reschedule/re-prioritise must work right here. Each row is draggable
                  by its id so it can be moved to another quadrant. */}
              {quads[q.k].slice(0, rowCap).map((t) => (
                <div
                  key={t.id}
                  className="eq-drag"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move' }}
                >
                  <TaskRow
                    task={t} dense
                    onToggle={onToggle}
                    onSchedule={onSchedule}
                    onSetPriority={onSetPriority}
                    onPatch={onPatch}
                  />
                </div>
              ))}
              {quads[q.k].length > rowCap && (
                <div className="eq-more">+{quads[q.k].length - rowCap} more</div>
              )}
              {quads[q.k].length === 0 && <div className="eq-empty">Drop a task here</div>}
            </div>
          </div>
        ))}
      </div>

      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
