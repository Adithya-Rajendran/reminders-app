import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpcomingWidget from '../../client/src/widgets/UpcomingWidget.jsx'
import { fakeTasks } from './fakeCtx.js'

const future = (days) => new Date(Date.now() + days * 86400e3).toISOString()

// A representative task widget rendered purely from the injected ctx.tasks
// capability — proves the connection-layer delivery works end to end (no store
// import, no fetch) and that an interaction delegates back through the capability.
describe('UpcomingWidget', () => {
  it('shows the empty state when nothing is upcoming', () => {
    render(<UpcomingWidget tasks={fakeTasks([])} />)
    expect(screen.getByText(/Nothing upcoming/i)).toBeInTheDocument()
  })

  it('renders scheduled tasks delivered through ctx.tasks', () => {
    const cap = fakeTasks([
      { id: 1, title: 'Pay rent', due_date: future(1), done: false, priority: 0, labels: [] },
      { id: 2, title: 'Dentist', due_date: future(3), done: false, priority: 0, labels: [] },
    ])
    render(<UpcomingWidget tasks={cap} />)
    expect(screen.getByText('Pay rent')).toBeInTheDocument()
    expect(screen.getByText('Dentist')).toBeInTheDocument()
  })

  it('completing a row delegates to the capability (update + emitChanged)', async () => {
    const cap = fakeTasks([{ id: 1, title: 'Pay rent', due_date: future(1), done: false, priority: 0, labels: [] }])
    render(<UpcomingWidget tasks={cap} />)
    await userEvent.click(screen.getByLabelText(/complete/i))
    expect(cap.calls.update).toContainEqual([1, { done: true }])
  })

  it('honors per-instance config: quickWinsFirst seeds the 2-minute filter on', () => {
    // A task WITHOUT the 2min label and one WITH it — with the filter pre-enabled,
    // only the quick win should render (proves config.quickWinsFirst is wired, not
    // just accepted). The filter chip should also start pressed.
    const cap = fakeTasks([
      { id: 1, title: 'Long report', due_date: future(1), done: false, priority: 0, labels: [] },
      { id: 2, title: 'Reply to Sam', due_date: future(1), done: false, priority: 0, labels: [{ title: '2min' }] },
    ])
    render(<UpcomingWidget tasks={cap} config={{ quickWinsFirst: true, compactLimit: 5 }} />)
    expect(screen.getByText('Reply to Sam')).toBeInTheDocument()
    expect(screen.queryByText('Long report')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2-min only/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows an error alert and restores the draft when create rejects', async () => {
    const cap = fakeTasks([])
    // Override create to reject with a JSON-encoded server error message
    cap.create = () => Promise.reject(new Error(JSON.stringify({ error: 'Server busy' })))
    render(<UpcomingWidget tasks={cap} projects={[{ id: 42 }]} />)

    const input = screen.getByLabelText(/Add a scheduled task/i)
    await userEvent.type(input, 'file taxes friday')
    await userEvent.click(screen.getByLabelText(/Add task/i))

    // The role="alert" error div should appear with the extracted message
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server busy'))
    // The draft text should be restored so the user doesn't lose their input
    expect(input).toHaveValue('file taxes friday')
  })
})
