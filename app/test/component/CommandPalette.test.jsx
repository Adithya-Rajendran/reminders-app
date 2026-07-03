import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The palette pulls tasks from the shared store and notes from the network; mock
// both so the omnibox renders deterministically. Fixtures go through vi.hoisted so
// the (hoisted) vi.mock factories may legally reference them. (tasklib imports `tk`
// from api.js in the same graph, so the api mock must export it too.)
const { TASKS, NOTES } = vi.hoisted(() => ({
  TASKS: [
    { id: 1, title: 'Call the plumber', done: false, due_date: null },
    { id: 2, title: 'Draft the roadmap', done: false, due_date: null },
    { id: 9, title: 'Old finished thing', done: true, due_date: null },
  ],
  NOTES: [{ path: 'n/Weekly.md', title: 'Weekly review', folder: 'n', updated: '2026-07-01' }],
}))

vi.mock('../../client/src/taskstore.js', () => ({
  getTasks: () => TASKS,
  subscribe: () => () => {},
}))
vi.mock('../../client/src/api.js', () => ({
  api: vi.fn(async () => ({})),
  tk: vi.fn(async () => []),
  reminderGroups: vi.fn(async () => []),
  notesApi: { list: vi.fn(async () => ({ configured: true, notes: NOTES })) },
}))

import CommandPalette from '../../client/src/CommandPalette.jsx'
import { onRevealTask } from '../../client/src/revealbus.js'
import { onAddWidget } from '../../client/src/boardbus.js'

const openPalette = async (props = {}) => {
  render(<CommandPalette onClose={() => {}} commands={[]} {...props} />)
  return screen.findByRole('combobox', { name: 'Command palette' })
}

// A matched title renders as split <b> highlight runs and each row carries a type
// tag, so assert on the option rows' text content (robust to both) rather than on a
// finicky accessible-name match.
const optionTexts = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent || '')
const rowShown = (re) => waitFor(() => expect(optionTexts().some((t) => re.test(t))).toBe(true))
const rowAbsent = (re) => expect(optionTexts().some((t) => re.test(t))).toBe(false)

describe('CommandPalette omnibox', () => {
  it('finds a live task by its content and reveals it on Enter', async () => {
    const seen = []
    const off = onRevealTask((id) => seen.push(id))
    const input = await openPalette()
    await userEvent.type(input, 'plumber')
    await rowShown(/Call the plumber/i)
    // a completed task is not surfaced by content search
    rowAbsent(/Old finished thing/i)
    await userEvent.keyboard('{Enter}')
    expect(seen).toContain('1')
    off()
  })

  it('resolves a renamed surface by its old name and ADDS it when off-board', async () => {
    const added = []
    const off = onAddWidget((type) => added.push(type))
    const input = await openPalette()
    await userEvent.type(input, 'triage')
    // Prioritize is not on the (empty) board, so the nav entry offers to add it…
    await rowShown(/Add Prioritize/i)
    // …and activating it actually adds the surface (run → emitAddWidget → onAddWidget),
    // which is the whole point — the renamed surface never dead-ends.
    await userEvent.keyboard('{Enter}')
    expect(added).toContain('triage')
    off()
  })

  it('shows a curated start list (core surfaces + a recent note) before you type', async () => {
    await openPalette()
    // Blank query → the curated "start here" list: core surfaces resolved by type…
    await rowShown(/Add Overview/i)
    // …plus recent notes, with no typing at all.
    await rowShown(/Weekly review/i)
  })

  it('plain typing searches notes too (no mode prefix needed)', async () => {
    const input = await openPalette()
    await userEvent.type(input, 'weekly')
    await rowShown(/Weekly review/i)
  })

  it('> restricts to commands and runs a passed command', async () => {
    const run = vi.fn()
    const input = await openPalette({ commands: [{ id: 'x', label: 'Toggle theme', run }] })
    await userEvent.type(input, '>toggle')
    await rowShown(/Toggle theme/i)
    // a task must NOT appear in command-only mode
    rowAbsent(/Call the plumber/i)
    await userEvent.keyboard('{Enter}')
    expect(run).toHaveBeenCalled()
  })
})
