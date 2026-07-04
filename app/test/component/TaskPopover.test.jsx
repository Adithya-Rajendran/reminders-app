import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TaskPopover from '../../client/src/widget-sdk/ui/TaskPopover.jsx'

// The calendar task-chip popover renders from a plain task + a captured anchor
// rect (no FullCalendar needed). Complete/Reschedule delegate to the handlers
// CalendarWidget wires from useTaskList — asserted here via spies, which is the
// component's whole contract.
const rect = { top: 40, left: 40, bottom: 60, width: 120 }
const todayIso = () => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.toISOString() }
const task = { id: 5, title: 'Dentist', priority: 2, due_date: todayIso(), reminders: [], labels: [] }
const noop = () => {}

describe('TaskPopover', () => {
  it('renders the task title and due chip in a dialog', () => {
    render(<TaskPopover task={task} anchorRect={rect} onComplete={noop} onSchedule={noop} onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: /task: dentist/i })
    expect(dialog).toHaveTextContent('Dentist')
    expect(dialog).toHaveTextContent(/today/i) // the due chip
  })

  it('Complete delegates the completion (recurring-aware handler owns the rest)', async () => {
    const onComplete = vi.fn()
    render(<TaskPopover task={task} anchorRect={rect} onComplete={onComplete} onSchedule={noop} onClose={noop} />)
    await userEvent.click(screen.getByRole('button', { name: /complete/i }))
    expect(onComplete).toHaveBeenCalledWith(task)
  })

  it('Esc closes', async () => {
    const onClose = vi.fn()
    render(<TaskPopover task={task} anchorRect={rect} onComplete={noop} onSchedule={noop} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
