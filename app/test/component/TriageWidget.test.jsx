import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TriageWidget from '../../client/src/widgets/TriageWidget.jsx'
import { fakeTasks } from './fakeCtx.js'

// The Triage widget renders purely from the injected ctx.tasks capability. XP is a
// PURE DERIVED view over completions, so the celebration fires when the real
// completion total rises (a one-off gains a done_at) — not optimistically on click.
const todayIso = () => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.toISOString() }

describe('TriageWidget', () => {
  it('shows the all-clear state when there are no open tasks', () => {
    render(<TriageWidget tasks={fakeTasks([])} instanceId="triage-empty" />)
    expect(screen.getByText(/All clear/i)).toBeInTheDocument()
    expect(screen.getByText(/Lv 1/)).toBeInTheDocument()
  })

  it('elevates the highest-priority/dread task to the frog "boss" and queues the rest', () => {
    const cap = fakeTasks([
      { id: 1, title: 'Tax return', priority: 3, dread: 4, done: false, labels: [] },   // → boss
      { id: 2, title: 'Email landlord', priority: 0, done: false, labels: [] },          // → queue (untriaged)
    ])
    render(<TriageWidget tasks={cap} instanceId="triage-boss" />)
    expect(screen.getByText(/Today’s frog · boss/i)).toBeInTheDocument()
    expect(screen.getByText('Tax return')).toBeInTheDocument()
    expect(screen.getByText('Email landlord')).toBeInTheDocument() // in the triage queue
  })

  it('completing the boss delegates the completion to the capability', async () => {
    const cap = fakeTasks([
      { id: 1, title: 'Tax return', priority: 3, dread: 4, time_estimate: 90, done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="triage-complete" />)
    await userEvent.click(screen.getByLabelText(/complete: tax return/i))
    expect(cap.calls.update).toContainEqual([1, { done: true }])
  })

  it('animates an XP fly-up only when a real completion is recorded (derived total rises)', () => {
    const task = { id: 1, title: 'Tax return', priority: 3, dread: 4, time_estimate: 90, done: false, labels: [] }
    const cap = fakeTasks([task])
    render(<TriageWidget tasks={cap} instanceId="triage-flyup" />)
    expect(screen.queryByText(/\+\d+ XP/)).not.toBeInTheDocument() // nothing on mount (history is primed silently)
    act(() => cap._set([{ ...task, done: true, done_at: todayIso() }])) // server records the completion
    expect(screen.getByText(/\+\d+ XP/)).toBeInTheDocument()
  })

  it('fires a level-up when a recorded completion crosses an XP threshold', () => {
    // A maximal task (P5 · 120m · dread5) is worth enough XP to clear level 1→2.
    const task = { id: 7, title: 'Ship the release', priority: 5, dread: 5, time_estimate: 120, done: false, labels: [] }
    const cap = fakeTasks([task])
    render(<TriageWidget tasks={cap} instanceId="triage-levelup" />)
    act(() => cap._set([{ ...task, done: true, done_at: todayIso() }]))
    expect(screen.getByText(/Level 2!/)).toBeInTheDocument()
  })

  it('matrix quadrants render actionable rows — completing one removes it from the quadrant', async () => {
    const overdue = () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(9, 0, 0, 0); return d.toISOString() }
    const cap = fakeTasks([
      { id: 1, title: 'Frog task', priority: 5, dread: 5, done: false, labels: [] },
      { id: 2, title: 'Urgent important', priority: 3, due_date: overdue(), done: false, labels: [] }, // → Q1
    ])
    render(<TriageWidget tasks={cap} instanceId="triage-matrix-rows" />)
    await userEvent.click(screen.getByRole('tab', { name: /matrix/i }))
    // The quadrant renders a real TaskRow (role=checkbox), not a read-only echo…
    const box = screen.getByRole('checkbox', { name: /complete: urgent important/i })
    await userEvent.click(box)
    // …and completing delegates to the capability + optimistically leaves the grid.
    expect(cap.calls.update).toContainEqual([2, { done: true }])
    expect(screen.queryByText('Urgent important')).not.toBeInTheDocument()
  })

  it('the level badge opens the XP explainer with computed level numbers', async () => {
    const cap = fakeTasks([
      { id: 1, title: 'Tax return', priority: 3, dread: 4, time_estimate: 90, done: false, labels: [] },
    ])
    render(<TriageWidget tasks={cap} instanceId="triage-xp-explainer" />)
    await userEvent.click(screen.getByRole('button', { name: /lv 1/i }))
    const dialog = screen.getByRole('dialog', { name: /how xp works/i })
    // Live-computed numbers (no completions yet → level 1, 0 into the 100 span),
    // the frog example, and the trust line.
    expect(dialog).toHaveTextContent(/Level 1 — 0 \/ 100 XP/)
    expect(dialog).toHaveTextContent(/Tax return/)
    expect(dialog).toHaveTextContent(/can’t be lost/)
  })
})
