import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DailyWidget from '../../client/src/widgets/DailyWidget.jsx'
import { fakeTasks, fakePlan } from './fakeCtx.js'

// Smoke + optimistic-revert test for DailyWidget.
// The plan (ctx.plan) is a tiny id list: the widget applies it locally and
// reverts on a rejected plan.set call.

describe('DailyWidget', () => {
  it('shows the plan section heading and suggestions heading', async () => {
    render(
      <DailyWidget
        tasks={fakeTasks([])}
        projects={[{ id: 1 }]}
        plan={fakePlan([])}
        instanceId="dw-smoke"
      />,
    )
    // findBy* waits, which also lets the mount-time plan.get effect settle
    // (silences the act() warning). NOTE the curly apostrophe — the widget
    // renders 'Today’s focus', not a straight quote.
    expect(await screen.findByText(/today’s focus/i)).toBeInTheDocument()
    expect(screen.getByText(/suggestions/i)).toBeInTheDocument()
  })

  it('optimistic-reverts and shows the error alert when plan.set rejects', async () => {
    // One suggestion task so there's a button to click.
    const t = { id: 'task-1', title: 'Write report', done: false, priority: 0, labels: [],
      due_date: null, time_estimate: 0, dread: 0, is_goal: false }
    const tasks = fakeTasks([t])

    // plan.set always rejects.
    const plan = fakePlan([])
    plan.set = () => Promise.reject(new Error('network'))

    render(
      <DailyWidget
        tasks={tasks}
        projects={[{ id: 1 }]}
        plan={plan}
        instanceId="dw-revert"
      />,
    )

    // The task should appear as a suggestion.
    expect(await screen.findByText('Write report')).toBeInTheDocument()

    // Click the SUGGESTION button (.daily-sg): the quick-add submit button
    // carries the same "Add to today" title, so an unscoped title query is
    // ambiguous.
    const suggestion = screen.getByText('Write report').closest('.daily-sg')
    expect(suggestion).not.toBeNull()
    await userEvent.click(suggestion)

    // After the rejection, the error alert should appear.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        // Exact curly-apostrophe string copied from DailyWidget.jsx line 45.
        'Could not save today’s plan',
      ),
    )
  })
})
