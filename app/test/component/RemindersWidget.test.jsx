import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RemindersWidget from '../../client/src/widgets/RemindersWidget.jsx'
import { fakeTasks, fakeGroups } from './fakeCtx.js'

// Reminders is the most coupled task widget — quick-add, groups, optimistic edits.
// Rendered from fake ctx.tasks + ctx.groups capabilities (no api, no store).
describe('RemindersWidget', () => {
  it('renders the quick-add and an empty state with a connected inbox', async () => {
    render(
      <RemindersWidget
        tasks={fakeTasks([])} groups={fakeGroups()}
        events={[]} projects={[{ id: 1 }]} group={null} instanceId="r1"
      />,
    )
    expect(await screen.findByText(/No reminders yet/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Remind me to/i)).toBeInTheDocument()
  })

  it('lists a reminder delivered through ctx.tasks', async () => {
    const cap = fakeTasks([
      { id: 1, title: 'Call mum', done: false, priority: 0, labels: [], reminders: [{ reminder: new Date().toISOString() }] },
    ])
    render(
      <RemindersWidget
        tasks={cap} groups={fakeGroups()}
        events={[]} projects={[{ id: 1 }]} group={null} instanceId="r1"
      />,
    )
    expect(await screen.findByText('Call mum')).toBeInTheDocument()
  })
})
