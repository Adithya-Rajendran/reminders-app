import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TriageWidget from '../../client/src/widgets/TriageWidget.jsx'
import { fakeTasks } from './fakeCtx.js'

// The Prioritize widget renders purely from the injected ctx.tasks capability.
// It's the Eisenhower matrix (bucketed by the EXPLICIT task.important flag ×
// due-proximity urgency) plus a "Most important" callout. No XP/levels/streaks —
// gamification is retired. Actions (complete, drag-between-quadrants) delegate to
// the tasks capability.
const overdue = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(9, 0, 0, 0); return d.toISOString() }

// jsdom's userEvent has no drag-and-drop; fire the native DnD events directly with
// a minimal dataTransfer stand-in so we can assert the drop persists via onPatch.
function drop(sourceEl, targetEl, id) {
  const data = new Map([['text/plain', String(id)]])
  const dataTransfer = { getData: (k) => data.get(k) || '', setData: (k, v) => data.set(k, v), effectAllowed: '' }
  const fire = (el, type) => {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    ev.dataTransfer = dataTransfer
    el.dispatchEvent(ev)
  }
  fire(sourceEl, 'dragstart')
  fire(targetEl, 'dragover')
  fire(targetEl, 'drop')
}

describe('TriageWidget (Prioritize)', () => {
  it('shows the nothing-flagged state when no task is important', () => {
    const cap = fakeTasks([{ id: 1, title: 'Loose task', important: false, done: false, labels: [] }])
    render(<TriageWidget tasks={cap} instanceId="tri-empty" />)
    expect(screen.getByText(/Nothing flagged/i)).toBeInTheDocument()
  })

  it('buckets tasks into quadrants by the IMPORTANCE flag, not priority', () => {
    const cap = fakeTasks([
      // High priority but NOT flagged important + urgent → Q3 (Delegate), never Q1.
      { id: 1, title: 'Loud but unimportant', priority: 5, important: false, due_date: overdue(), done: false, labels: [] },
      // Flagged important + urgent → Q1 (Do first).
      { id: 2, title: 'Important urgent', priority: 1, important: true, due_date: overdue(), done: false, labels: [] },
      // Flagged important, no urgency → Q2 (Schedule).
      { id: 3, title: 'Important later', priority: 0, important: true, done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="tri-buckets" />)
    const q1 = screen.getByText('Do first').closest('.eq')
    const q2 = screen.getByText('Schedule').closest('.eq')
    const q3 = screen.getByText('Delegate').closest('.eq')
    expect(q1).toHaveTextContent('Important urgent')
    expect(q2).toHaveTextContent('Important later')
    expect(q3).toHaveTextContent('Loud but unimportant') // priority alone never lands in Q1
    expect(q1).not.toHaveTextContent('Loud but unimportant')
  })

  it('names the top important task in the "Most important" callout', () => {
    const cap = fakeTasks([
      { id: 1, title: 'Ship release', priority: 4, important: true, due_date: overdue(), done: false, labels: [] },
      { id: 2, title: 'Minor important', priority: 1, important: true, done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="tri-focus" />)
    const focus = screen.getByText(/Most important/i).closest('.tri-focus')
    expect(focus).toHaveTextContent('Ship release') // Q1 top by priority
  })

  it('completing the callout task delegates the completion to the capability', async () => {
    const cap = fakeTasks([
      { id: 5, title: 'Do the thing', priority: 3, important: true, due_date: overdue(), done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="tri-complete-focus" />)
    await userEvent.click(screen.getByRole('button', { name: /complete: do the thing/i }))
    expect(cap.calls.update).toContainEqual([5, { done: true }])
  })

  it('completing a quadrant row delegates to the capability and leaves the grid', async () => {
    const cap = fakeTasks([
      { id: 7, title: 'Urgent important', priority: 3, important: true, due_date: overdue(), done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="tri-complete-row" />)
    // The quadrant renders a real TaskRow (role=checkbox), not a read-only echo…
    await userEvent.click(screen.getByRole('checkbox', { name: /complete: urgent important/i }))
    // …and completing delegates to the capability + optimistically leaves the grid.
    expect(cap.calls.update).toContainEqual([7, { done: true }])
    expect(screen.queryByText('Urgent important')).not.toBeInTheDocument()
  })

  it('dragging a task into "Do first" flips important:true and nudges it urgent', () => {
    const cap = fakeTasks([
      // Starts not-important, no due date → sits in Q4 (Later).
      { id: 9, title: 'Reframe me', important: false, done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="tri-drag-up" />)
    const source = screen.getByText('Reframe me').closest('.eq-drag')
    const target = screen.getByText('Do first').closest('.eq')
    drop(source, target, 9)
    // Q1 = important + urgent: flip the flag AND give it a "now" so it stays put.
    expect(cap.calls.update).toHaveLength(1)
    const [id, patch] = cap.calls.update[0]
    expect(id).toBe(9)
    expect(patch.important).toBe(true)
    expect(patch.due_date).toBeTruthy()
  })

  it('dragging into "Later" clears importance without wiping an existing due date', () => {
    const due = overdue()
    const cap = fakeTasks([
      { id: 11, title: 'Down-rank me', important: true, due_date: due, done: false, labels: [] }, // in Q1
    ])
    render(<TriageWidget tasks={cap} instanceId="tri-drag-down" />)
    const source = screen.getByText('Down-rank me').closest('.eq-drag')
    const target = screen.getByText('Later').closest('.eq')
    drop(source, target, 11)
    // Q4 = not-important, non-urgent column: flip important false, DON'T touch due.
    expect(cap.calls.update).toContainEqual([11, { important: false }])
    // No due_date in the patch — a deliberate deadline is never wiped.
    const [, patch] = cap.calls.update[0]
    expect(patch.due_date).toBeUndefined()
  })
})
