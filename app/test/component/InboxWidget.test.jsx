import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InboxWidget from '../../client/src/widgets/InboxWidget.jsx'
import { fakeTasks } from './fakeCtx.js'

// Minimal stand-in for the ctx.organizer capability the app injects. The Inbox
// widget only reads areas() (async) and contexts() (sync) on mount; the filter
// subscription surface isn't exercised here, so those are no-ops.
function fakeOrganizer({ areas = [], contexts = [] } = {}) {
  return {
    areas: () => Promise.resolve(areas),
    contexts: () => contexts,
    getFilter: () => ({ areaId: null, context: null }),
    setFilter() {},
    subscribe() { return () => {} },
  }
}

// An Inbox task is open + explicitly unclarified (clarified === false); capture
// creates them that way, and selectInbox is what the widget filters on.
const inboxTask = (over = {}) => ({ id: 1, title: 'Book dentist', done: false, clarified: false, labels: [], ...over })

describe('InboxWidget', () => {
  it('shows the empty state when nothing needs clarifying', () => {
    render(<InboxWidget tasks={fakeTasks([])} organizer={fakeOrganizer()} instanceId="ib-empty" />)
    expect(screen.getByText(/Inbox zero — nothing to clarify\./i)).toBeInTheDocument()
  })

  it('a clarified/done task is NOT in the Inbox (selectInbox filters it out)', () => {
    // Only clarified===false open tasks are the Inbox: a done task and an already
    // clarified task both fall out, leaving inbox zero.
    const cap = fakeTasks([
      { id: 1, title: 'Old capture', done: false, clarified: true, labels: [] },
      { id: 2, title: 'Finished thing', done: true, clarified: false, labels: [] },
    ])
    render(<InboxWidget tasks={cap} organizer={fakeOrganizer()} instanceId="ib-filter" />)
    expect(screen.getByText(/Inbox zero/i)).toBeInTheDocument()
    expect(screen.queryByText('Old capture')).not.toBeInTheDocument()
  })

  it('surfaces the focused unclarified item and the count to clarify', () => {
    const cap = fakeTasks([inboxTask(), inboxTask({ id: 2, title: 'Reply to Sam' })])
    render(<InboxWidget tasks={cap} organizer={fakeOrganizer()} instanceId="ib-focus" />)
    expect(screen.getByText('Book dentist')).toBeInTheDocument()   // focused card
    expect(screen.getByText('Reply to Sam')).toBeInTheDocument()   // up-next peek
    expect(screen.getByText(/2 to clarify/i)).toBeInTheDocument()
  })

  it('Clarify asks the capability to mark the task clarified (moving it out of the Inbox)', async () => {
    const cap = fakeTasks([inboxTask()])
    render(<InboxWidget tasks={cap} organizer={fakeOrganizer()} instanceId="ib-clarify" />)
    await userEvent.click(screen.getByRole('button', { name: /^Clarify$/i }))
    expect(cap.calls.update).toContainEqual([1, { clarified: true }])
  })

  it('Someday clarifies with no date and tags the someday/maybe label', async () => {
    const cap = fakeTasks([inboxTask()])
    render(<InboxWidget tasks={cap} organizer={fakeOrganizer()} instanceId="ib-someday" />)
    await userEvent.click(screen.getByRole('button', { name: /someday/i }))
    expect(cap.calls.update).toContainEqual([1, { clarified: true, labels: [{ title: 'someday/maybe' }] }])
  })

  it('marking Important patches the explicit importance flag', async () => {
    const cap = fakeTasks([inboxTask()])
    render(<InboxWidget tasks={cap} organizer={fakeOrganizer()} instanceId="ib-important" />)
    // ImportanceControl's accessible name is its visible label "Important" (text
    // wins over the title attr); its title toggles to "Mark as important" when off.
    await userEvent.click(screen.getByRole('button', { name: /^Important$/i }))
    expect(cap.calls.update).toContainEqual([1, { important: true }])
  })

  it('picking an Area patches the task with the chosen area id', async () => {
    const cap = fakeTasks([inboxTask()])
    render(
      <InboxWidget
        tasks={cap}
        organizer={fakeOrganizer({ areas: [{ id: 'area-x', name: 'Home', kind: 'area', color: '#4a8' }] })}
        instanceId="ib-area"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /project \/ area/i }))
    await userEvent.click(await screen.findByRole('option', { name: /Home/i }))
    expect(cap.calls.update).toContainEqual([1, { area: 'area-x' }])
  })
})
