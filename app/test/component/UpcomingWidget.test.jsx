import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
