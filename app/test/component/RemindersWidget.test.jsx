import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  // Quick-add is the widget's own logic (parse tokens, then merge the active group
  // label with parsed *labels). A group-locked widget forces its group first in the
  // label list, deduped against a *label that repeats it, and the parsed tokens
  // (due date, priority) flow into the create body.
  it('quick-add in a group-locked widget merges the group with parsed *labels (deduped) and applies tokens', async () => {
    const cap = fakeTasks([])
    render(
      <RemindersWidget
        tasks={cap} groups={fakeGroups(['Work'])}
        events={[]} projects={[{ id: 7 }]} group="Work" instanceId="r-qa"
      />,
    )
    const input = await screen.findByLabelText(/Add a reminder/i)
    // *Work repeats the locked group (must dedupe); *finance is a fresh label;
    // "tomorrow" → due date + reminder; "!2" → priority 2.
    await userEvent.type(input, 'Buy milk tomorrow !2 *finance *Work')
    await userEvent.click(screen.getByRole('button', { name: /Add reminder/i }))

    await waitFor(() => expect(cap.calls.create.length).toBe(1))
    const [projectId, body] = cap.calls.create[0]
    expect(projectId).toBe(7) // the inbox (projects[0].id)
    expect(body.title).toBe('Buy milk')
    expect(body.priority).toBe(2)
    // Group first, then parsed labels, with the duplicated "Work" collapsed.
    expect(body.labels).toEqual(['Work', 'finance'])
    // "tomorrow" parsed into a due date that also seeds a reminder at the same instant.
    expect(body.due_date).toBeTruthy()
    expect(body.reminders).toEqual([{ reminder: body.due_date }])
  })
})
