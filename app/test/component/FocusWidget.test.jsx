import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FocusWidget from '../../client/src/widgets/FocusWidget.jsx'
import { fakePlan, fakeTasks } from './fakeCtx.js'
import { WidgetSizeContext } from '../../client/src/widget-sdk'

const sized = (ui, value) => <WidgetSizeContext.Provider value={value}>{ui}</WidgetSizeContext.Provider>

describe('FocusWidget', () => {
  it('keeps the current task and start control visible in the short layout', async () => {
    const tasks = fakeTasks([
      { id: 'task-1', title: 'Draft the proposal', done: false, priority: 3, labels: [], due_date: null, is_goal: false },
    ])

    render(sized(
      <FocusWidget tasks={tasks} events={[]} plan={fakePlan([])} instanceId="fw-short" />,
      { w: 'sm', h: 'xs', name: 'mini', width: 320, height: 150 },
    ))

    expect(await screen.findByText('Draft the proposal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start focus/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /less time/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /park a thought/i })).not.toBeInTheDocument()
  })
})
