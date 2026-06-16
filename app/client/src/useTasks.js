import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { updateTask, deleteTask, createTask, attachLabels, isRealDate } from './tasklib.js'
import { emitTasksChanged } from './tasksbus.js'
import {
  subscribe, getTasks, getState, refresh,
  patchTask as storePatch, removeTask as storeRemove, replaceTasks,
} from './taskstore.js'

// Shared task-list behaviour: derive a widget's view from the single shared store
// (taskstore.js) via a memoized `selector`, plus optimistic priority/due edits, a
// recurring-aware completion with Undo, and delete with a re-create Undo.
// Mutations are applied to the SHARED store (so sibling widgets update instantly)
// and broadcast on the tasks bus (so the store reconciles with the server).
export function useTaskList(selector) {
  const all = useSyncExternalStore(subscribe, getTasks)
  const state = useSyncExternalStore(subscribe, getState)
  const tasks = useMemo(() => selector(all), [all, selector])

  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)

  const load = useCallback(() => refresh(), [])

  const showUndo = useCallback((label, fn) => {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])
  const dismissUndo = useCallback(() => { clearTimeout(undoTimer.current); setUndo(null) }, [])

  const onSetPriority = useCallback((task, priority) => {
    storePatch(task.id, { priority })
    updateTask(task.id, { priority }).then(emitTasksChanged).catch(() => refresh())
  }, [])

  // Set due date + (optionally) a reminder at the same instant, from the picker.
  // due_date is an ISO string or ZERO_DATE to clear; reminder is an ISO or null.
  const onSchedule = useCallback((task, { due_date, reminder }) => {
    const reminders = reminder ? [{ reminder }] : []
    storePatch(task.id, { due_date, reminders })
    updateTask(task.id, { due_date, reminders }).then(emitTasksChanged).catch(() => refresh())
  }, [])

  const onToggle = useCallback(async (task) => {
    if (task.done) { storePatch(task.id, { done: false }); updateTask(task.id, { done: false }).then(emitTasksChanged).catch(() => refresh()); return }
    const snapshot = getTasks()
    storeRemove(task.id) // optimistic remove with exit animation handled in CSS
    try {
      const r = await updateTask(task.id, { done: true })
      emitTasksChanged()
      if (r && r.done === false) {
        // Recurring: the store keeps the task open and (if it can) bumps the due
        // date. If the date didn't actually advance (e.g. no due date set), it can
        // never complete — say so honestly instead of a misleading "Rescheduled".
        const advanced = isRealDate(r.due_date) && (!isRealDate(task.due_date) || new Date(r.due_date) > new Date(task.due_date))
        showUndo(advanced ? 'Rescheduled ↻' : 'Recurring — set a due date to complete', null)
        refresh()
      } else {
        showUndo('Completed', async () => { await updateTask(task.id, { done: false }).catch(() => {}); emitTasksChanged(); refresh() })
      }
    } catch { replaceTasks(snapshot) }
  }, [showUndo])

  // Delete is permanent, so Undo re-creates the task (best effort: core fields +
  // reminders + labels). The restored task gets a new id.
  const onDelete = useCallback(async (task) => {
    const snapshot = getTasks()
    storeRemove(task.id)
    try {
      await deleteTask(task.id)
      emitTasksChanged()
      showUndo('Deleted', async () => {
        try {
          const created = await createTask(task.project_id || 1, {
            title: task.title,
            description: task.description || '',
            priority: task.priority || 0,
            ...(isRealDate(task.due_date) ? { due_date: task.due_date } : {}),
            ...(task.repeat_after ? { repeat_after: task.repeat_after, repeat_mode: task.repeat_mode || 0 } : {}),
          })
          if (created?.id) {
            if (Array.isArray(task.reminders) && task.reminders.length) await updateTask(created.id, { reminders: task.reminders }).catch(() => {})
            if (Array.isArray(task.labels) && task.labels.length) await attachLabels(created.id, task.labels.map((l) => l.title)).catch(() => {})
          }
        } catch { /* best-effort restore */ }
        emitTasksChanged(); refresh()
      })
    } catch { replaceTasks(snapshot); refresh() }
  }, [showUndo])

  return { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo }
}
