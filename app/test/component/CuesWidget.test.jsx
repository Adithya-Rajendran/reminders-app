import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CuesWidget from '../../client/src/widgets/CuesWidget.jsx'
import { fakeTasks, fakeGroups } from './fakeCtx.js'

// Cues renders a flow board from the same shared store via ctx.tasks + ctx.groups.
// Smoke-level: proves it mounts and reflects the capability (the pointer/canvas
// drag math needs real layout geometry, so that stays out of jsdom).
describe('CuesWidget', () => {
  it('shows the empty state when no reminders/cues are available', async () => {
    render(<CuesWidget tasks={fakeTasks([])} groups={fakeGroups()} group="" />)
    expect(await screen.findByText(/No reminders to map/i)).toBeInTheDocument()
  })

  it('places a flow-positioned task on the board', async () => {
    const cap = fakeTasks([
      { id: 1, uid: 'u1', title: 'Stretch', done: false, cue: 'after coffee', flow: { x: 10, y: 10, to: [] } },
    ])
    render(<CuesWidget tasks={cap} groups={fakeGroups()} group="" />)
    expect(await screen.findByText('Stretch')).toBeInTheDocument()
  })
})
