import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OverviewWidget from '../../client/src/widgets/OverviewWidget.jsx'
import { fakeTasks } from './fakeCtx.js'
import { WidgetSizeContext } from '../../client/src/widget-sdk'

// Overview is the ENGAGE summary: an honest status line, the overdue + due-today
// counts, the single most-important open task, the next calendar event, and an
// inline quick-capture that lands in the Inbox (clarified:false). It reads the
// injected ctx.tasks/ctx.calendar/ctx.organizer capabilities only.

const iso = (offsetDays, h = 9) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(h, 0, 0, 0)
  return d.toISOString()
}
const overdue = () => iso(-1)
const today = () => iso(0)

// A no-op organizer (pass-through filter) — the default for these tests.
function fakeOrganizer(filter = null) {
  return { subscribe: () => () => {}, getFilter: () => filter, setFilter() {} }
}
// A calendar stub returning a fixed event list from listEvents.
function fakeCalendar(events = []) {
  const calls = { listEvents: [] }
  return { calls, listEvents: (s, e) => { calls.listEvents.push([s, e]); return Promise.resolve({ events }) } }
}
const sized = (ui, value) => <WidgetSizeContext.Provider value={value}>{ui}</WidgetSizeContext.Provider>

describe('OverviewWidget', () => {
  it('shows "Clear" and empty sections when there are no open tasks', async () => {
    render(
      <OverviewWidget
        tasks={fakeTasks([])}
        calendar={fakeCalendar([])}
        organizer={fakeOrganizer()}
        instanceId="ov-clear"
      />,
    )
    expect(await screen.findByText('Clear')).toBeInTheDocument()
    // Both counts read 0.
    const overdueMetric = screen.getByText('Overdue').closest('.ov-metric')
    expect(overdueMetric).toHaveTextContent('0')
  })

  it('reports the overdue count in the status line and metric, and turns it "warn"', async () => {
    const cap = fakeTasks([
      { id: 1, title: 'Late A', due_date: overdue(), done: false, priority: 0, labels: [] },
      { id: 2, title: 'Late B', due_date: overdue(), done: false, priority: 0, labels: [] },
      { id: 3, title: 'Due now', due_date: today(), done: false, priority: 0, labels: [] },
    ])
    render(
      <OverviewWidget tasks={cap} calendar={fakeCalendar([])} organizer={fakeOrganizer()} instanceId="ov-overdue" />,
    )
    // Honest status: two overdue -> "2 overdue".
    const statusEl = await screen.findByText('2 overdue')
    expect(statusEl).toBeInTheDocument()
    // Status line carries a non-color cue class too (meaning never by color alone).
    expect(statusEl.closest('.ov-status')).toHaveClass('warn')
    // Overdue metric reads 2, due-today reads 1.
    expect(screen.getByText('Overdue').closest('.ov-metric')).toHaveTextContent('2')
    expect(screen.getByText('Due today').closest('.ov-metric')).toHaveTextContent('1')
  })

  it('picks the important+urgent (Q1) task as "Most important", not the loud unimportant one', async () => {
    const cap = fakeTasks([
      // High priority but NOT flagged important + urgent -> must NOT be the pick.
      { id: 1, title: 'Loud but unimportant', priority: 5, important: false, due_date: overdue(), done: false, labels: [] },
      // Flagged important + urgent -> Q1, the correct pick.
      { id: 2, title: 'The real priority', priority: 1, important: true, due_date: overdue(), done: false, labels: [] },
    ])
    render(
      <OverviewWidget tasks={cap} calendar={fakeCalendar([])} organizer={fakeOrganizer()} instanceId="ov-frog" />,
    )
    const focusRow = (await screen.findByText('The real priority')).closest('.ov-focus-row')
    expect(focusRow).not.toBeNull()
    expect(focusRow).toHaveTextContent('The real priority')
    expect(focusRow).not.toHaveTextContent('Loud but unimportant')

    // Its checkbox completes the task via the tasks capability.
    await userEvent.click(screen.getByRole('checkbox', { name: /complete: the real priority/i }))
    await waitFor(() => expect(cap.calls.update).toContainEqual([2, { done: true }]))
  })

  it('shows the earliest upcoming calendar event today', async () => {
    const cap = fakeTasks([])
    // Two events at future offsets from NOW (not absolute hours), so 'Standup' is
    // always the earliest still-upcoming pick regardless of wall-clock time — the
    // old iso(0,22)/iso(0,23) pinning flaked in the last 2h of the day.
    const soon = (min) => new Date(Date.now() + min * 60000).toISOString()
    const cal = fakeCalendar([
      { id: 'e2', title: 'Later meeting', start: soon(30), allDay: false },
      { id: 'e1', title: 'Standup', start: soon(15), allDay: false },
    ])
    render(<OverviewWidget tasks={cap} calendar={cal} organizer={fakeOrganizer()} instanceId="ov-cal" />)
    expect(await screen.findByText('Standup')).toBeInTheDocument()
    // The widget queried the calendar for a day range.
    expect(cal.calls.listEvents.length).toBe(1)
  })

  it('respects the active organizer filter, scoping counts to the filtered area', async () => {
    const cap = fakeTasks([
      { id: 1, title: 'Work late', area: 'area-work', due_date: overdue(), done: false, priority: 0, labels: [] },
      { id: 2, title: 'Home late', area: 'area-home', due_date: overdue(), done: false, priority: 0, labels: [] },
    ])
    render(
      <OverviewWidget
        tasks={cap}
        calendar={fakeCalendar([])}
        organizer={fakeOrganizer({ areaId: 'area-work' })}
        instanceId="ov-filter"
      />,
    )
    // Only the work task is overdue within the scoped view -> "1 overdue".
    expect(await screen.findByText('1 overdue')).toBeInTheDocument()
    expect(screen.getByText('Overdue').closest('.ov-metric')).toHaveTextContent('1')
  })

  it('captures a thought to the Inbox with clarified:false', async () => {
    const cap = fakeTasks([{ id: 1, title: 'Existing', project_id: 7, done: false, labels: [] }])
    render(<OverviewWidget tasks={cap} calendar={fakeCalendar([])} organizer={fakeOrganizer()} instanceId="ov-cap" />)
    const input = await screen.findByLabelText(/capture a task to the inbox/i)
    await userEvent.type(input, 'Buy milk{Enter}')
    await waitFor(() => expect(cap.calls.create.length).toBe(1))
    const [projectId, body] = cap.calls.create[0]
    // Resolved the inbox project id from an existing task's project_id.
    expect(projectId).toBe(7)
    expect(body.title).toBe('Buy milk')
    expect(body.clarified).toBe(false)
  })

  it('keeps the short compact layout focused on status, priority and capture', async () => {
    const cap = fakeTasks([
      { id: 1, title: 'Do the important thing', due_date: today(), done: false, priority: 0, important: true, labels: [] },
    ])
    render(sized(
      <OverviewWidget tasks={cap} calendar={fakeCalendar([{ title: 'Later event', start: new Date(Date.now() + 3600000).toISOString() }])} organizer={fakeOrganizer()} />,
      { w: 'sm', h: 'xs', name: 'mini', width: 300, height: 150 },
    ))

    expect(await screen.findByText('On track')).toBeInTheDocument()
    expect(screen.getByLabelText(/0 overdue, 1 due today/i)).toBeInTheDocument()
    expect(screen.getByText('Do the important thing')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/capture to inbox/i)).toBeInTheDocument()
    expect(screen.queryByText('Next up')).not.toBeInTheDocument()
  })
})
