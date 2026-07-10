import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CalendarWidget from '../../client/src/widgets/CalendarWidget.jsx'
import { fakeTasks } from './fakeCtx.js'

// FullCalendar renders its full DOM under jsdom, so these tests pin the widget's
// interaction wiring: the task-chip quick-actions popover (with the shared
// recurring-aware completion + the merged undo bar), timed tasks landing in the
// timeGrid lane, list-view event rows opening the edit modal, and the
// delete→undo path. The last three exist because a live-explorer pass reported
// them broken — they weren't, and now a regression will actually fail here.

function fakeCalendar(events = []) {
  const calls = { createEvent: [], updateEvent: [], deleteEvent: [] }
  return {
    calls,
    accounts: () => Promise.resolve({ accounts: [] }),
    listEvents: () => Promise.resolve({ events }),
    createEvent: (e) => { calls.createEvent.push(e); return Promise.resolve({}) },
    updateEvent: (e) => { calls.updateEvent.push(e); return Promise.resolve({}) },
    deleteEvent: (e) => { calls.deleteEvent.push(e); return Promise.resolve({}) },
  }
}

const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString() }
const flush = () => act(() => Promise.resolve())

describe('CalendarWidget', () => {
  it('task chip opens the quick-actions popover; Complete delegates and shows the undo bar', async () => {
    const cap = fakeTasks([{ id: 1, title: 'Dentist task', due_date: at(13), done: false, labels: [] }])
    render(<CalendarWidget tasks={cap} calendar={fakeCalendar()} />)
    await flush()

    const chip = await screen.findByText('Dentist task')
    expect(chip.closest('.fc-event').title).toMatch(/click for actions/i)
    await userEvent.click(chip)

    const pop = screen.getByRole('dialog', { name: /task: dentist task/i })
    expect(pop).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /complete/i }))

    expect(cap.calls.update).toContainEqual([1, { done: true }])
    expect(screen.queryByRole('dialog', { name: /task: dentist task/i })).not.toBeInTheDocument()
    // The task undo rides the same single bottom bar slot as the event undo.
    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.queryByText('Dentist task')).not.toBeInTheDocument() // chip gone (optimistic store remove)
  })

  it('a TIMED task renders inside the timeGrid lane in Day view (not lost, not all-day)', async () => {
    const cap = fakeTasks([{ id: 1, title: 'Timed task', due_date: at(13), done: false, labels: [] }])
    const { container } = render(<CalendarWidget tasks={cap} calendar={fakeCalendar()} />)
    await flush()
    await act(async () => { container.querySelector('.fc-timeGridDay-button').click(); await Promise.resolve() })
    const title = await screen.findByText('Timed task')
    expect(title.closest('.fc-timegrid-event')).toBeTruthy()
  })

  it('an event row in the Agenda (list) view opens the edit modal', async () => {
    const ev = [{ id: 'e1', title: 'Standup', start: at(10), end: at(11), allDay: false, accountId: 1, objectUrl: 'u1', listUrl: 'l1', etag: 'x' }]
    const { container } = render(<CalendarWidget tasks={fakeTasks([])} calendar={fakeCalendar(ev)} />)
    await flush()
    await act(async () => { container.querySelector('.fc-listWeek-button').click(); await Promise.resolve() })
    await userEvent.click(await screen.findByText('Standup'))
    expect(screen.getByRole('dialog', { name: /edit event/i })).toBeInTheDocument()
  })

  it('deleting an event from the modal is optimistic with a visible Undo', async () => {
    const ev = [{ id: 'e1', title: 'Old title', start: at(10), end: at(11), allDay: false, accountId: 1, objectUrl: 'u1', listUrl: 'l1', etag: 'x' }]
    const cal = fakeCalendar(ev)
    render(<CalendarWidget tasks={fakeTasks([])} calendar={cal} />)
    await flush()
    await userEvent.click(await screen.findByText('Old title'))
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))

    expect(cal.calls.deleteEvent).toContainEqual({ accountId: 1, objectUrl: 'u1' })
    expect(await screen.findByText('Event deleted')).toBeInTheDocument()
    // Undo re-creates the event (best effort) — the bar's action is wired.
    await userEvent.click(screen.getByRole('button', { name: /undo/i }))
    expect(cal.calls.createEvent.length).toBe(1)
    expect(cal.calls.createEvent[0].summary).toBe('Old title')
  })

  it('shows a loading skeleton over the still-mounted calendar chrome while the first vevents fetch is pending, then clears it', async () => {
    let resolveEvents
    const cal = fakeCalendar([])
    cal.listEvents = () => new Promise((resolve) => { resolveEvents = () => resolve({ events: [] }) })
    const { container } = render(<CalendarWidget tasks={fakeTasks([])} calendar={cal} />)
    await flush()

    expect(container.querySelector('.cal-vevents-scrim')).toBeTruthy()
    expect(container.querySelector('.fc-toolbar')).toBeTruthy() // FullCalendar itself stays mounted underneath

    await act(async () => { resolveEvents(); await Promise.resolve() })
    expect(container.querySelector('.cal-vevents-scrim')).toBeFalsy()
  })

  it('shows the full-body ErrorState when the vevents fetch fails before anything has ever loaded, and Retry recovers it', async () => {
    let fail = true
    const cal = fakeCalendar([])
    cal.listEvents = () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve({ events: [] }))
    render(<CalendarWidget tasks={fakeTasks([])} calendar={cal} />)
    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t reach your server/i)

    fail = false
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await flush()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the stale calendar visible with a ReconnectBanner (not the full ErrorState) when a LATER vevents refetch fails', async () => {
    const ev = [{ id: 'e1', title: 'Standup', start: at(10), end: at(11), allDay: false, accountId: 1, objectUrl: 'u1', listUrl: 'l1', etag: 'x' }]
    const cal = fakeCalendar(ev)
    // FullCalendar can call the events function more than once while its initial
    // view settles under jsdom (no real layout) — succeed every call until the
    // initial render is confirmed, THEN flip to failing for the explicit refetch
    // below, so this doesn't depend on the exact number of initial invocations.
    let broken = false
    cal.listEvents = () => (broken ? Promise.reject(new Error('boom')) : Promise.resolve({ events: ev }))
    render(<CalendarWidget tasks={fakeTasks([])} calendar={cal} />)
    await flush()
    expect(await screen.findByText('Standup')).toBeInTheDocument()

    // The existing visibilitychange recovery wiring triggers a fresh vevents
    // fetch (see the widget's "cross-device freshness" effect); this fake fails it.
    broken = true
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // no full-body takeover…
    expect(screen.getByText(/can.t reach your server/i)).toBeInTheDocument() // …just the reconnect strip…
    expect(screen.getByText('Standup')).toBeInTheDocument() // …and the stale event stays visible
  })
})
