import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  // ---- error UX ----

  it('shows an error notice when pin fails', async () => {
    const notesList = [{ path: 'Note.md', title: 'Note', folder: '', tags: [], pinned: false }]
    const notes = fakeNotes({ configured: true, notes: notesList })
    // Override setPinned to reject (default stub would succeed)
    notes.setPinned = () => Promise.reject(new Error('network'))

    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-pin" />)

    // Wait for tree to render, then click the ⋯ menu button on the note row
    const menuBtn = await screen.findByRole('button', { name: /Note actions/i })
    await userEvent.click(menuBtn)

    // Context menu renders via portal — find the Pin button
    const pinBtn = await screen.findByRole('menuitem', { name: /pin to top/i })
    await userEvent.click(pinBtn)

    // Error notice should appear in the widget's notice slot
    await waitFor(() => expect(screen.getByText(/pin failed/i)).toBeInTheDocument())
  })

  it('shows an error notice when trash fails', async () => {
    const notesList = [{ path: 'Note2.md', title: 'Note2', folder: '', tags: [], pinned: false }]
    const notes = fakeNotes({ configured: true, notes: notesList })
    notes.trash = () => Promise.reject(new Error('server error'))

    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-trash" />)

    const menuBtn = await screen.findByRole('button', { name: /Note actions/i })
    await userEvent.click(menuBtn)

    const trashBtn = await screen.findByRole('menuitem', { name: /move to trash/i })
    await userEvent.click(trashBtn)

    await waitFor(() => expect(screen.getByText(/move to trash failed/i)).toBeInTheDocument())
  })

  it('keeps existing notes in the tree when a background refresh fails', async () => {
    // The widget only wipes to ErrorState on initial load failure. A subsequent
    // refresh failure must keep the existing tree and set stale=true (showing
    // ReconnectBanner) rather than replacing the tree with an error card. The
    // second refresh is triggered for real (via the open-note bus, which calls
    // load()) — without it this test passed even with the guard deleted.
    const notesList = [{ path: 'Gamma.md', title: 'Gamma', folder: '', tags: [] }]
    const notes = fakeNotes({ configured: true, notes: notesList })
    let listCalls = 0
    notes.list = async () => {
      listCalls++
      if (listCalls === 1) return { configured: true, notes: notesList }
      throw new Error('offline') // subsequent calls fail
    }
    let fireOpen
    notes.onOpenNote = (fn) => { fireOpen = fn; return () => {} }
    // Opening a note loads the editor; keep it trivially resolvable.
    notes.get = () => Promise.resolve({ title: 'Gamma', body: 'x', etag: 'e1', meta: {}, folder: '' })

    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-stale" />)
    // Tree populated on first load
    expect(await screen.findByText('Gamma')).toBeInTheDocument()
    // Trigger a background refresh that fails.
    await act(async () => { fireOpen('Gamma.md') })
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))
    // Tree survives (not replaced by ErrorState) and the stale banner shows.
    await waitFor(() => expect(screen.getByText(/last synced copy/i)).toBeInTheDocument())
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    // ErrorState title should NOT appear (apostrophe-agnostic — the UI renders
    // a curly one, and a straight-quote regex made this assertion vacuous).
    expect(screen.queryByText(/Couldn['’]t reach your server/i)).toBeNull()
  })
})
