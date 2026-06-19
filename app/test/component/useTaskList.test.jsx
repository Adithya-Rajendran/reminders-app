import { describe, it, expect } from 'vitest'
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
})
