import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTaskList } from '../../client/src/widget-sdk'
import { fakeTasks } from './fakeCtx.js'

// The shared task-list hook holds the trickiest widget logic — optimistic edits,
// the recurring-aware complete, and delete/undo — now parameterized by the
// injected ctx.tasks capability. Tested against the in-memory fake (no fetch).
describe('useTaskList(ctx.tasks, selector)', () => {
  it('derives the view from the shared store via the selector', () => {
    const cap = fakeTasks([{ id: 1, title: 'a', done: false }, { id: 2, title: 'b', done: true }])
    const { result } = renderHook(() => useTaskList(cap, (all) => all.filter((t) => !t.done)))
    expect(result.current.state).toBe('ready')
    expect(result.current.tasks.map((t) => t.id)).toEqual([1])
  })

  it('completing optimistically removes the task, calls update, and offers Undo', async () => {
    const cap = fakeTasks([{ id: 1, title: 'a', done: false }])
    const { result } = renderHook(() => useTaskList(cap, (all) => all))
    await act(async () => { await result.current.onToggle({ id: 1, done: false }) })
    expect(cap.calls.update).toContainEqual([1, { done: true }])
    expect(cap.calls.emitChanged).toBeGreaterThan(0)
    expect(result.current.tasks.find((t) => t.id === 1)).toBeUndefined()
    expect(result.current.undo?.label).toBe('Completed')
  })

  it('a recurring complete (server keeps it open) reports a reschedule, not "Completed"', async () => {
    const cap = fakeTasks([{ id: 7, title: 'water plants', done: false }])
    // Server says still-open with an advanced due date → recurring path.
    const tomorrow = new Date(Date.now() + 86400e3).toISOString()
    cap.update = (id, patch) => { cap.calls.update.push([id, patch]); return Promise.resolve({ id, done: false, due_date: tomorrow }) }
    const { result } = renderHook(() => useTaskList(cap, (all) => all))
    await act(async () => { await result.current.onToggle({ id: 7, done: false, due_date: new Date().toISOString() }) })
    expect(result.current.undo?.label).toContain('Rescheduled')
  })

  it('delete removes optimistically, calls del, and offers a re-create Undo', async () => {
    const cap = fakeTasks([{ id: 5, title: 'x', done: false }])
    const { result } = renderHook(() => useTaskList(cap, (all) => all))
    await act(async () => { await result.current.onDelete({ id: 5, title: 'x' }) })
    expect(cap.calls.del).toContain(5)
    expect(result.current.tasks.length).toBe(0)
    expect(result.current.undo?.label).toBe('Deleted')
  })

  it('setting priority patches the store and persists via update', () => {
    const cap = fakeTasks([{ id: 3, title: 'p', done: false, priority: 0 }])
    const { result } = renderHook(() => useTaskList(cap, (all) => all))
    act(() => { result.current.onSetPriority({ id: 3 }, 5) })
    expect(result.current.tasks.find((t) => t.id === 3).priority).toBe(5) // optimistic patch
    expect(cap.calls.update).toContainEqual([3, { priority: 5 }])
  })

  // The audit's gap: the earlier tests assert the undo bar APPEARS after a
  // toggle/delete but never fire its action. These invoke undo.fn (what the
  // UndoBar's "Undo" button calls) and assert the mutation is actually reversed.
  it('invoking the complete-undo action re-opens the task via update(id, {done:false})', async () => {
    const cap = fakeTasks([{ id: 1, title: 'a', done: false }])
    const { result } = renderHook(() => useTaskList(cap, (all) => all))
    await act(async () => { await result.current.onToggle({ id: 1, done: false }) })
    // The completed task left the list optimistically; the undo bar offers the reversal.
    expect(result.current.tasks.find((t) => t.id === 1)).toBeUndefined()
    expect(result.current.undo?.label).toBe('Completed')
    // Two update calls after firing undo: the toggle's done:true, then undo's done:false.
    expect(cap.calls.update).toEqual([[1, { done: true }]])
    // Fire the undo bar's action (what the UndoBar's "Undo" button invokes).
    await act(async () => { await result.current.undo.fn() })
    // It persists the reversal — the task is set back to open on the server.
    expect(cap.calls.update).toContainEqual([1, { done: false }])
    expect(cap.calls.emitChanged).toBeGreaterThan(1) // toggle emitted once; undo emits again
  })

  it('invoking the delete-undo action re-creates the task via create()', async () => {
    const cap = fakeTasks([{ id: 5, title: 'x', done: false, priority: 3, project_id: 42 }])
    const { result } = renderHook(() => useTaskList(cap, (all) => all))
    await act(async () => { await result.current.onDelete({ id: 5, title: 'x', priority: 3, project_id: 42 }) })
    expect(result.current.tasks.length).toBe(0)
    expect(result.current.undo?.label).toBe('Deleted')
    // Fire the undo bar's action — delete is permanent, so restore re-creates.
    await act(async () => { await result.current.undo.fn() })
    // create() ran against the task's own project with its core fields carried over.
    expect(cap.calls.create.length).toBe(1)
    const [projectId, body] = cap.calls.create[0]
    expect(projectId).toBe(42)
    expect(body.title).toBe('x')
    expect(body.priority).toBe(3)
  })

  it('the undo bar expires after ~6s (fake timers)', async () => {
    vi.useFakeTimers()
    try {
      const cap = fakeTasks([{ id: 9, title: 'a', done: false }])
      const { result } = renderHook(() => useTaskList(cap, (all) => all))
      // Real awaited promises inside a fake-timer test: let microtasks flush.
      await act(async () => { await result.current.onToggle({ id: 9, done: false }) })
      expect(result.current.undo?.label).toBe('Completed')
      act(() => { vi.advanceTimersByTime(6000) })
      expect(result.current.undo).toBeNull() // the 6s auto-dismiss cleared it
    } finally {
      vi.useRealTimers()
    }
  })
})
