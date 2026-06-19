import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotesWidget from '../../client/src/widgets/NotesWidget.jsx'
import { fakeNotes } from './fakeCtx.js'

// The Notes widget is the most coupled — it now receives the whole notes client
// through ctx.notes (no api/notesbus import). These cover its mount states and
// confirm it fetches through the injected capability.
describe('NotesWidget', () => {
  it('shows the unconfigured state when Nextcloud is not set up', async () => {
    render(<NotesWidget notes={fakeNotes({ configured: false })} onOpenSettings={() => {}} instanceId="n1" />)
    expect(await screen.findByText(/Nextcloud account/i)).toBeInTheDocument()
  })

  it('shows the empty state and fetches via ctx.notes when configured but empty', async () => {
    const notes = fakeNotes({ configured: true, notes: [] })
    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n1" />)
    expect(await screen.findByText(/No notes yet/i)).toBeInTheDocument()
    expect(notes.calls.list).toBeGreaterThan(0)
  })

  it('lists notes delivered through ctx.notes', async () => {
    const notes = fakeNotes({ configured: true, notes: [{ path: 'Alpha.md', title: 'Alpha', folder: '', tags: [] }] })
    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n1" />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })
})
