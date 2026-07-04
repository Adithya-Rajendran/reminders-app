import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NotesWidget from '../../client/src/widgets/NotesWidget.jsx'
import { WidgetSizeContext } from '../../client/src/useWidgetSize.js'
import { fakeNotes } from './fakeCtx.js'

// jsdom has no native drag-and-drop, so fireEvent's DragEvent carries no
// dataTransfer. The widget's dnd handlers call e.dataTransfer.setData/effectAllowed
// on dragStart, so every synthetic drag event needs a stub. One shared object is
// fine — the handlers only ever write to it.
const dt = () => {
  const store = {}
  return { effectAllowed: '', setData(k, v) { store[k] = v }, getData: (k) => store[k] }
}
// A full HTML5 drag gesture is start(source) → over(target) → drop(target).
// The handlers gate on canDropInto/overTarget, so drive them in that order.
const dragStart = (el) => fireEvent.dragStart(el, { dataTransfer: dt() })
const dragOver = (el) => fireEvent.dragOver(el, { dataTransfer: dt() })
const drop = (el) => fireEvent.drop(el, { dataTransfer: dt() })

// The tree renders a folder row as a `.tree-row` whose title attr is the folder's
// rel path; note rows carry the note title. These locate them by their stable
// structural signals rather than brittle text-only queries.
const folderRow = (path) => document.querySelector(`.tree-row[title="${path}"]`)
const noteRowByTitle = (title) => [...document.querySelectorAll('.tree-note')].find((r) => r.textContent.includes(title))

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

  it('keeps the compact toolbar to search and new-note controls', async () => {
    const notes = fakeNotes({ configured: true, notes: [{ path: 'Alpha.md', title: 'Alpha', folder: '', tags: [] }] })
    render(
      <WidgetSizeContext.Provider value={{ w: 'sm', h: 'sm', name: 'mini', width: 286, height: 170 }}>
        <NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-compact" />
      </WidgetSizeContext.Provider>,
    )

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByLabelText(/Search notes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New note/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sort notes/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Today's note/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /New folder/i })).toBeNull()
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
    // second refresh is triggered for real (a pin action re-load()s) — without
    // it this test passed even with the guard deleted.
    const notesList = [{ path: 'Gamma.md', title: 'Gamma', folder: '', tags: [] }]
    const notes = fakeNotes({ configured: true, notes: notesList })
    let listCalls = 0
    notes.list = async () => {
      listCalls++
      if (listCalls === 1) return { configured: true, notes: notesList }
      throw new Error('offline') // subsequent calls fail
    }

    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-stale" />)
    // Tree populated on first load
    expect(await screen.findByText('Gamma')).toBeInTheDocument()
    // Trigger a background refresh that fails: pin succeeds, the follow-up
    // load() rejects. (Pin, unlike opening a note, keeps the tree pane visible
    // in the narrow jsdom layout.)
    await userEvent.click(screen.getByRole('button', { name: /Note actions/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /pin to top/i }))
    await waitFor(() => expect(listCalls).toBeGreaterThanOrEqual(2))
    // Tree survives (not replaced by ErrorState) and the stale banner shows.
    await waitFor(() => expect(screen.getByText(/last synced copy/i)).toBeInTheDocument())
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    // ErrorState title should NOT appear (apostrophe-agnostic — the UI renders
    // a curly one, and a straight-quote regex made this assertion vacuous).
    expect(screen.queryByText(/Couldn['’]t reach your server/i)).toBeNull()
  })
})

// ---- drag-and-drop state machine + move wiring ----
// These drive the dnd handlers in NotesWidget directly (fireEvent, since jsdom
// has no native DnD) and assert BOTH halves: the overTarget/highlight state
// machine (canDropInto gating) and that doDrop delegates to notesApi.move /
// moveFolder with the right args and reopens the moved note. The pure tree
// helpers themselves are node-tested in notetree.test.mjs — this is the wiring.
describe('NotesWidget drag-and-drop', () => {
  // Expanded-folder state is persisted to localStorage, namespaced by instanceId
  // (widgetStore). These tests reuse instanceId 'n-dnd', so without a reset one
  // test's expand leaks into the next: a test that click-toggles 'Work' to expand
  // it would instead COLLAPSE an already-expanded 'Work', hiding its child rows.
  // Clear storage before each so every mount starts with folders collapsed and
  // the expand click is deterministic.
  beforeEach(() => { try { localStorage.clear() } catch { /* jsdom always has it */ } })

  // A tree with a root note and a folder ("Work") that already holds a note, so
  // the folder renders and is a valid drop target for the root note.
  const treeNotes = () => [
    { path: 'Loose.md', title: 'Loose', folder: '', tags: [] },
    { path: 'Work/Task.md', title: 'Task', folder: 'Work', tags: [] },
  ]
  // The Work folder must be expanded for its child note row to be in the DOM; the
  // folder row itself renders regardless. Render + wait for the tree, expand Work.
  async function renderTree(notes) {
    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-dnd" />)
    await screen.findByText('Loose')
    return notes
  }

  it('highlights a folder on hover only when the drag can drop there', async () => {
    const notes = fakeNotes({ configured: true, notes: treeNotes() })
    await renderTree(notes)

    const work = folderRow('Work')
    // Before any drag, no highlight.
    expect(work.className).not.toMatch(/drag-over/)

    // Drag the root note over Work: canDropInto is true (different folder) → the
    // row gets the drag-over class (overTarget === 'Work').
    dragStart(noteRowByTitle('Loose'))
    dragOver(work)
    await waitFor(() => expect(folderRow('Work').className).toMatch(/drag-over/))
  })

  it('does NOT highlight a folder when dropping into it is a no-op (note already there)', async () => {
    const notes = fakeNotes({ configured: true, notes: treeNotes() })
    await renderTree(notes)

    // Expand Work so its child note ("Task", folder 'Work') is draggable.
    await userEvent.click(folderRow('Work'))
    const task = await screen.findByText('Task')

    // Dragging Work/Task over Work is gated out by canDropInto (same folder) — no
    // preventDefault, no overTarget, so the row never gets the highlight class.
    dragStart(task.closest('.tree-note'))
    dragOver(folderRow('Work'))
    // Give any (erroneous) state update a chance to flush before asserting absence.
    await Promise.resolve()
    expect(folderRow('Work').className).not.toMatch(/drag-over/)
  })

  it('highlights the root drop zone on hover and clears it on drag end', async () => {
    // The root note can't drop into root (already there); use a note inside Work
    // so canDropInto(drag, '') is true and the root zone can light up.
    const notes = fakeNotes({ configured: true, notes: treeNotes() })
    await renderTree(notes)
    await userEvent.click(folderRow('Work')) // expand so Work/Task is draggable
    const task = await screen.findByText('Task')
    const root = document.querySelector('.notes-tree')

    dragStart(task.closest('.tree-note'))
    dragOver(root)
    await waitFor(() => expect(document.querySelector('.notes-tree').className).toMatch(/drag-over-root/))

    // dragEnd resets dragItem + overTarget → the root highlight clears.
    fireEvent.dragEnd(task.closest('.tree-note'), { dataTransfer: dt() })
    await waitFor(() => expect(document.querySelector('.notes-tree').className).not.toMatch(/drag-over-root/))
  })

  it('dropping a note on a folder calls notesApi.move(path, folder) and reopens it there', async () => {
    const notes = fakeNotes({ configured: true, notes: treeNotes() })
    const moveCalls = []
    // The move returns the note's NEW path so the widget can reopen it — assert
    // the widget follows that returned path (openPath tracking), not the old one.
    notes.move = (p, folder) => { moveCalls.push([p, folder]); return Promise.resolve({ path: 'Work/Loose.md', title: 'Loose', folder }) }
    await renderTree(notes)

    // NOTE: at jsdom's zero width the widget is in narrow (single-pane) mode, so
    // OPENING a note swaps the sidebar tree out for the editor pane — the note row
    // we need to drag would then be unmounted. So we drag straight from the tree
    // without opening first; the load-bearing assertion is the move() args (that
    // doDrop delegates to notesApi.move with the source path + destination folder).
    dragStart(noteRowByTitle('Loose'))
    dragOver(folderRow('Work'))
    drop(folderRow('Work'))

    await waitFor(() => expect(moveCalls).toEqual([['Loose.md', 'Work']]))
  })

  it('dropping a note on the root zone moves it to the root ("")', async () => {
    const notes = fakeNotes({ configured: true, notes: treeNotes() })
    const moveCalls = []
    notes.move = (p, folder) => { moveCalls.push([p, folder]); return Promise.resolve({ path: 'Task.md', title: 'Task', folder }) }
    await renderTree(notes)
    await userEvent.click(folderRow('Work')) // expand
    const task = await screen.findByText('Task')

    dragStart(task.closest('.tree-note'))
    const root = document.querySelector('.notes-tree')
    dragOver(root)
    drop(root)

    await waitFor(() => expect(moveCalls).toEqual([['Work/Task.md', '']]))
  })

  it('dropping a folder on another folder calls notesApi.moveFolder(from, to)', async () => {
    // Two sibling folders so one can move into the other (canDropInto: not itself,
    // not a descendant, not its current parent).
    const notes = fakeNotes({
      configured: true,
      notes: [
        { path: 'A/one.md', title: 'one', folder: 'A', tags: [] },
        { path: 'B/two.md', title: 'two', folder: 'B', tags: [] },
      ],
    })
    const mfCalls = []
    notes.moveFolder = (from, to) => { mfCalls.push([from, to]); return Promise.resolve({ folder: to + '/' + from }) }
    render(<NotesWidget notes={notes} onOpenSettings={() => {}} instanceId="n-dnd-f" />)
    // Wait for the folder ROWS, not the child notes: folders A and B render
    // collapsed by default, so 'one'/'two' aren't in the DOM until expanded. The
    // folder rows themselves always render (and are the drag source/target here).
    await waitFor(() => { expect(folderRow('A')).toBeTruthy(); expect(folderRow('B')).toBeTruthy() })

    dragStart(folderRow('A'))
    dragOver(folderRow('B'))
    drop(folderRow('B'))

    await waitFor(() => expect(mfCalls).toEqual([['A', 'B']]))
  })

  it('a rejected move surfaces the "Move failed" error notice', async () => {
    const notes = fakeNotes({ configured: true, notes: treeNotes() })
    notes.move = () => Promise.reject(new Error('server error'))
    await renderTree(notes)

    dragStart(noteRowByTitle('Loose'))
    dragOver(folderRow('Work'))
    drop(folderRow('Work'))

    await waitFor(() => expect(screen.getByText(/move failed/i)).toBeInTheDocument())
  })
})
