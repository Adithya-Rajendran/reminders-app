import { useCallback, useMemo, useState } from 'react'
import {
  useTaskList, useWidgetSize,
  groupEisenhower, selectMostImportant, isRealDate, dueChip, applyOrganizer, useOrganizerFilter,
  EmptyState, ErrorState, ReconnectBanner, SkeletonRows, UndoBar,
  IconTarget,
} from '../../widget-sdk'
import { IMPORTANT_QUAD, URGENT_QUAD, soonDue } from './constants.js'
import { getTriageLayout } from './layout.js'
import MostImportantCard from './MostImportantCard.jsx'
import TriageMatrix from './TriageMatrix.jsx'
import './TriageWidget.css'

// The PRIORITIZE surface: an Eisenhower matrix you decide *in*. No points, no
// levels, no streaks, no confetti — just the four quadrants (by the explicit
// task.important flag × due-proximity urgency) with actionable rows, plus a
// "Most important" callout naming the single task to do now. Gamification is
// retired: this is a calm decision board, not a slot machine.
export default function TriageWidget({ tasks: tasksCap, organizer }) {
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onSchedule, onSetPriority, onPatch, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const sz = useWidgetSize()
  const filter = useOrganizerFilter(organizer)
  const layout = getTriageLayout(sz)

  // Which quadrant is under a drag right now — only for the drop-target highlight.
  const [dragOver, setDragOver] = useState(null)

  const scoped = useMemo(() => applyOrganizer(tasks, filter), [tasks, filter])
  const quads = useMemo(() => groupEisenhower(scoped, new Date()), [scoped])

  // "Most important" = the single task to do now (shared selector — see taskviews).
  // Strict here (no all-tasks fallback): when nothing is flagged important, the
  // callout shows the "Nothing flagged" prompt rather than picking an unflagged task.
  const mostImportant = useMemo(() => selectMostImportant(scoped, new Date()), [scoped])

  // Show YOUR WORK: name the concrete signals that made this the pick (importance
  // flag, urgency, priority) instead of an unexplained assertion.
  const whyFocus = useMemo(() => {
    if (!mostImportant) return ''
    const bits = []
    if (mostImportant.important) bits.push('important')
    const c = dueChip(mostImportant.due_date)
    if (c) bits.push(c.cls === 'overdue' ? 'overdue' : c.label === 'Today' ? 'due today' : `due ${c.label.toLowerCase()}`)
    if ((mostImportant.priority || 0) >= 4) bits.push('high priority')
    return bits.length ? bits.join(' · ') : 'top of your open list'
  }, [mostImportant])

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

  // The matrix IS the data (no separable toolbar/add-form here), so — like
  // Overview — the whole callout+matrix region gates together; only a refresh
  // failure with an already-loaded board keeps it visible via ReconnectBanner
  // instead of blanking to the full ErrorState.
  const hasData = tasks.length > 0

  return (
    <div className={`triage${layout.compact ? ' compact' : ''}${layout.short ? ' short' : ''}`}>
      {state === 'loading' && <SkeletonRows n={4} />}
      {state === 'error' && !hasData && <ErrorState onRetry={load} />}
      {state === 'error' && hasData && <ReconnectBanner onRetry={load} />}

      {(state === 'ready' || (state === 'error' && hasData)) && (
        <>
          {/* Most important callout — the one task to do now (no points). */}
          {mostImportant ? (
            <MostImportantCard task={mostImportant} showWhy={layout.showWhy} why={whyFocus} onToggle={onToggle} />
          ) : (
            <EmptyState icon={IconTarget} title="Nothing flagged" sub="Mark a task important (or drag one into a top row) to set your focus." />
          )}

          {/* Eisenhower matrix — droppable quadrants; dragging a task persists its axes. */}
          <TriageMatrix
            quads={quads}
            layout={layout}
            dragOver={dragOver}
            setDragOver={setDragOver}
            onDropInto={onDropInto}
            onToggle={onToggle}
            onSchedule={onSchedule}
            onSetPriority={onSetPriority}
            onPatch={onPatch}
          />
        </>
      )}

      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
