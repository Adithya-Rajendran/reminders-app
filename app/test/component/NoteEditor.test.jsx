import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// NoteEditor lazy-loads NoteRichEditor (tiptap) — far too heavy for jsdom and it
// would drag the whole editor stack (including the Callout case-collision) into
// the component test. Replace it with a controlled textarea that forwards edits
// through props.onChange exactly like the real editor's onUpdate does, so the
// debounce → save-queue → PUT wiring is what's under test, not tiptap.
vi.mock('../../client/src/NoteRichEditor.jsx', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="note body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// NoteEditor imports the real notesApi from ./api.js (app singleton, NOT an
// injected capability), so autosave/etag behavior can only be observed by mocking
// that module. The mock is a tiny in-memory notes server: get() serves a note,
// save() records each PUT's args and hands back a FRESH etag so the queue's
// etag-chaining is observable, folders()/backlinks() are the mount no-ops.
const server = {}
function resetServer() {
  server.saves = []          // [path, body, etag, tags] per save() call
  server.note = { title: 'Alpha', body: 'hello', etag: 'etag-0', folder: '', meta: { tags: [] } }
  server.nextEtag = 1
  server.saveImpl = null     // when set, overrides the default resolving save
}
resetServer()

vi.mock('../../client/src/api.js', () => ({
  // api()/tk() are unused here but exported by the real module — keep the shape.
  api: () => Promise.resolve({}),
  tk: () => Promise.resolve({}),
  notesApi: {
    get: () => Promise.resolve(server.note),
    save: (path, body, etag, tags) => {
      server.saves.push([path, body, etag, tags])
      if (server.saveImpl) return server.saveImpl({ path, body, etag, tags })
      const next = `etag-${server.nextEtag++}`
      return Promise.resolve({ etag: next })
    },
    folders: () => Promise.resolve({ folders: [] }),
    backlinks: () => Promise.resolve({ backlinks: [] }),
    rename: (p, t) => Promise.resolve({ path: p, title: t, etag: `etag-r${server.nextEtag++}` }),
    move: (p, folder) => Promise.resolve({ path: p, folder, etag: `etag-m${server.nextEtag++}` }),
    setPinned: () => Promise.resolve({ etag: `etag-p${server.nextEtag++}` }),
    trash: () => Promise.resolve({ ok: true }),
  },
}))

// Import AFTER the mocks are registered (vi.mock is hoisted, but keep it explicit).
const { default: NoteEditor } = await import('../../client/src/NoteEditor.jsx')

// Load the note (async get) and reach the ready state where the body textarea
// mounts. Uses real timers; the caller switches to fake timers afterward.
async function mountReady(props = {}) {
  render(<NoteEditor inline path="Alpha.md" notes={[]} {...props} />)
  return screen.findByLabelText('note body')
}

// The autosave debounce is 700ms (NoteEditor.onBody). Advance fake timers past it
// and let the awaited save()/onState microtasks settle inside act().
async function typeAndSettle(textarea, text) {
  // fireEvent.change drives the controlled textarea's onChange with the new string
  // (mirrors a keystroke batch); the mock forwards it to NoteEditor.onBody.
  await act(async () => { fireEvent.change(textarea, { target: { value: text } }) })
  await act(async () => { vi.advanceTimersByTime(700) })
  // Flush the awaited PUT + its onState continuation (microtask chain).
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('NoteEditor autosave', () => {
  beforeEach(() => { resetServer() })
  afterEach(() => { vi.useRealTimers() })

  it('debounces a body edit and PUTs once after 700ms with the loaded etag', async () => {
    const textarea = await mountReady()
    vi.useFakeTimers()

    await typeAndSettle(textarea, 'hello world')

    // Exactly one save, carrying the note's loaded etag (etag-0).
    expect(server.saves.length).toBe(1)
    expect(server.saves[0][0]).toBe('Alpha.md')       // path
    expect(server.saves[0][1]).toBe('hello world')    // body
    expect(server.saves[0][2]).toBe('etag-0')         // If-Match etag from load
  })

  it('does not PUT before the debounce elapses', async () => {
    const textarea = await mountReady()
    vi.useFakeTimers()

    await act(async () => { fireEvent.change(textarea, { target: { value: 'partial' } }) })
    await act(async () => { vi.advanceTimersByTime(500) }) // short of 700ms
    expect(server.saves.length).toBe(0)
  })

  it('applies the returned etag so a SECOND edit sends the NEW etag (no false 409)', async () => {
    const textarea = await mountReady()
    vi.useFakeTimers()

    await typeAndSettle(textarea, 'first edit')
    await typeAndSettle(textarea, 'second edit')

    expect(server.saves.length).toBe(2)
    // First PUT used the loaded etag; the server returned etag-1. The queue must
    // apply it so the SECOND PUT sends etag-1 (not the stale etag-0, which would
    // false-409). This is the etag-chaining contract of the save queue.
    expect(server.saves[0][2]).toBe('etag-0')
    expect(server.saves[1][2]).toBe('etag-1')
  })

  it('surfaces the conflict banner on a 409 and does not auto-retry', async () => {
    const textarea = await mountReady()
    vi.useFakeTimers()
    // Make the save 409 (etag conflict). The status field is how the queue/editor
    // distinguish a conflict from a generic network error.
    server.saveImpl = () => { const e = new Error('conflict'); e.status = 409; return Promise.reject(e) }

    await typeAndSettle(textarea, 'my change')

    // The dedicated 409 banner (not the generic "Save failed" chip) appears.
    expect(screen.getByText(/changed somewhere else/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep mine/i })).toBeInTheDocument()

    // A 409 must NOT re-mark the queue dirty: advancing time further triggers no
    // second PUT (auto-retry would silently clobber the remote change).
    const after = server.saves.length
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(server.saves.length).toBe(after)
  })

  it('a NON-409 save error shows the generic "Save failed" retry chip', async () => {
    const textarea = await mountReady()
    vi.useFakeTimers()
    server.saveImpl = () => { const e = new Error('network'); e.status = 500; return Promise.reject(e) }

    await typeAndSettle(textarea, 'edit that fails')

    expect(screen.getByText(/save failed/i)).toBeInTheDocument()
    // No conflict banner for a plain network error.
    expect(screen.queryByText(/changed somewhere else/i)).toBeNull()
  })

  it('applies an externally-supplied etag (extEtag) so the next save uses it', async () => {
    // A host action (pin from the tree menu) rewrites the open note server-side and
    // hands the editor the fresh etag via extEtag; the next autosave must send it.
    const textarea = await mountReady({ extEtag: { path: 'Alpha.md', etag: 'etag-ext' } })
    vi.useFakeTimers()

    await typeAndSettle(textarea, 'edit after external pin')

    expect(server.saves.length).toBe(1)
    expect(server.saves[0][2]).toBe('etag-ext')
  })
})
