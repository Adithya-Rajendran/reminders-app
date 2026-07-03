import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ReviewWidget from '../../client/src/widgets/ReviewWidget.jsx'
import { fakeTasks } from './fakeCtx.js'
import { startOfWeek } from '../../client/src/reviewstats.js'

// The Weekly Review renders purely from the injected ctx.tasks capability plus
// device-local UI state (last-reviewed + reflections). Completions come from
// one-off `done_at` timestamps and recurring `habit_log` dates. These tests
// pin dates RELATIVE to the current week (the widget calls computeReview with a
// live `new Date()`), so they stay green regardless of when they run.
//
// Default widget size in jsdom is the seed md/md tier (no ResizeObserver), so
// the spark/trend, details, and prompt all render without any size plumbing.

// A done-at ISO on the given Monday-based week offset (0 = this week, -1 = last
// week, …), noon so timezone never shifts the local calendar day.
function doneOnWeek(weekOffset, dayInWeek = 1) {
  const d = startOfWeek(new Date())
  d.setDate(d.getDate() + weekOffset * 7 + (dayInWeek - 1))
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}
const task = (id, doneAtISO) => ({ id, title: `t-${id}`, done: true, done_at: doneAtISO, labels: [] })

describe('ReviewWidget trend', () => {
  it('renders a multi-week trend (one bar per tracked week) with the current week emphasized', () => {
    // Completions spread across three distinct weeks so the trend has shape and
    // a real (non-zero) prior baseline.
    const cap = fakeTasks([
      task('a', doneOnWeek(0, 2)),   // this week
      task('b', doneOnWeek(0, 3)),   // this week
      task('c', doneOnWeek(-1, 2)),  // last week
      task('d', doneOnWeek(-2, 4)),  // two weeks ago
    ])
    const { container } = render(<ReviewWidget tasks={cap} instanceId="rv-trend" />)

    // The trend is a labelled image with one bar per week. Default is 8 weeks.
    const trend = container.querySelector('.rv-trend')
    expect(trend).not.toBeNull()
    expect(trend.getAttribute('role')).toBe('img')
    expect(trend.querySelectorAll('.rv-bar-col')).toHaveLength(8)

    // Endpoint emphasis is structural (a distinct class + a "now" tick), not
    // color-only, so the current week is identifiable without seeing color.
    expect(trend.querySelector('.rv-bar-now')).not.toBeNull()
    expect(within(trend).getByText('now')).toBeInTheDocument()

    // The faint average baseline exists (there are prior weeks to average).
    expect(trend.querySelector('.rv-trend-base')).not.toBeNull()

    // The headline count is this week's completions (2), and the caption names
    // the series as weekly (guards against a stale "per day · last 7 days").
    expect(container.querySelector('.rv-big').textContent).toBe('2')
    expect(screen.getByText(/tasks completed per week/i)).toBeInTheDocument()
  })

  it('shows an honest first-week label — never a divide-by-zero percentage — when last week is 0', () => {
    // Completions only this week; nothing last week => baseline 0.
    const cap = fakeTasks([
      task('a', doneOnWeek(0, 1)),
      task('b', doneOnWeek(0, 2)),
      task('c', doneOnWeek(0, 3)),
    ])
    const { container } = render(<ReviewWidget tasks={cap} instanceId="rv-zero" />)

    const delta = container.querySelector('.rv-delta')
    expect(delta).not.toBeNull()
    // No fabricated percentage against a zero baseline.
    expect(delta.textContent).not.toMatch(/%/)
    expect(delta.textContent).not.toMatch(/vs last week/)
    // The whole widget must never render the old dishonest "100% ... (0)" string
    // (or any "% vs last week (0)"): scan the full subtree.
    expect(container.textContent).not.toMatch(/100% vs last week/)
    expect(container.textContent).not.toMatch(/% vs last week \(0\)/)
    // Instead: an honest first-week-tracked label.
    expect(delta.textContent).toMatch(/first week/i)
    // …with the real absolute count still shown as the headline.
    expect(container.querySelector('.rv-big').textContent).toBe('3')
  })

  it('renders the guided-review entry alongside the trend (review flow preserved)', () => {
    const cap = fakeTasks([task('a', doneOnWeek(0, 1))])
    render(<ReviewWidget tasks={cap} instanceId="rv-flow" />)
    // Never-reviewed => the weekly-review prompt is due and offers to start.
    expect(screen.getByRole('button', { name: /start review/i })).toBeInTheDocument()
  })
})
