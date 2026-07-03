import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotePinWidget from '../../client/src/widgets/NotePinWidget.jsx'

const NOTES = [
  { path: 'n/Recent.md', title: 'Recent note', folder: 'n', updated: '2026-07-03' },
  { path: 'n/Older.md', title: 'Older note', folder: 'n', updated: '2026-07-01' },
]
const bodyFor = (path) => (path === 'n/Older.md' ? 'Older body text' : 'Recent body text')
function makeNotes(overrides = {}) {
  return {
    list: vi.fn(async () => ({ configured: true, notes: NOTES })),
    get: vi.fn(async (path) => ({ path, title: NOTES.find((n) => n.path === path)?.title, body: bodyFor(path) })),
    emitOpenNote: vi.fn(),
    ...overrides,
  }
}
let seq = 0
const freshId = () => 'w-notepin-' + (++seq)

describe('NotePinWidget', () => {
  beforeEach(() => { localStorage.clear() })

  it('surfaces the most recently edited note (title + body) on the grid by default', async () => {
    render(<NotePinWidget notes={makeNotes()} instanceId={freshId()} />)
    expect(await screen.findByText('Recent note')).toBeTruthy()
    expect(await screen.findByText('Recent body text')).toBeTruthy()
  })

  it('lets you pick which note is pinned, and loads it', async () => {
    render(<NotePinWidget notes={makeNotes()} instanceId={freshId()} />)
    await screen.findByText('Recent body text')
    await userEvent.click(screen.getByRole('button', { name: /choose which note to pin/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Older note/i }))
    expect(await screen.findByText('Older body text')).toBeTruthy()
  })

  it('opens the pinned note in the full editor via the note-open bus', async () => {
    const notes = makeNotes()
    render(<NotePinWidget notes={notes} instanceId={freshId()} />)
    await screen.findByText('Recent body text')
    await userEvent.click(screen.getByRole('button', { name: /open .* in notes/i }))
    expect(notes.emitOpenNote).toHaveBeenCalledWith('n/Recent.md')
  })

  it('prompts to connect Nextcloud when notes are not configured', async () => {
    render(<NotePinWidget notes={makeNotes({ list: vi.fn(async () => ({ configured: false })) })} instanceId={freshId()} />)
    expect(await screen.findByText(/aren’t connected/i)).toBeTruthy()
  })
})
