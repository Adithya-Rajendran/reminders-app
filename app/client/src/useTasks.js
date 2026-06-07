import { useCallback, useEffect, useRef, useState } from 'react'
import { updateTask, deleteTask, createTask, attachLabels, isRealDate } from './tasklib.js'
import { onTasksChanged, emitTasksChanged } from './tasksbus.js'

// Shared task-list behaviour: load, optimistic priority/due edits, a
// recurring-aware completion with Undo, and delete with a re-create Undo.
// Mutations broadcast on the tasks bus so sibling widgets stay consistent.
export function useTaskList(loader) {
  const [tasks, setTasks] = useState([])
  const [state, setState] = useState('loading')
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)
  const tasksRef = useRef([])
  tasksRef.current = tasks

  const load = useCallback(async () => {
    setState((s) => (s === 'ready' ? s : 'loading'))
    try { const t = await loader(); setTasks(Array.isArray(t) ? t : []); setState('ready') } catch { setState('error') }
  }, [loader])
  useEffect(() => { load() }, [load])

  // Reload (debounced) whenever ANY widget reports a task mutation, so a change
  // made in Inbox is reflected in Upcoming/Reminders and vice-versa.
  useEffect(() => {
    let timer = null
    const unsub = onTasksChanged(() => { clearTimeout(timer); timer = setTimeout(() => load(), 250) })
    return () => { clearTimeout(timer); unsub() }
  }, [load])

  const patch = (id, p) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)))

  const showUndo = (label, fn) => {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }
  const dismissUndo = () => { clearTimeout(undoTimer.current); setUndo(null) }

  const onSetPriority = (task, priority) => { patch(task.id, { priority }); updateTask(task.id, { priority }).then(emitTasksChanged).catch(() => load()) }
  // Set due date + (optionally) a reminder at the same instant, from the picker.
  // due_date is an ISO string or ZERO_DATE to clear; reminder is an ISO or null.
  const onSchedule = (task, { due_date, reminder }) => {
    const reminders = reminder ? [{ reminder }] : []
    patch(task.id, { due_date, reminders })
    updateTask(task.id, { due_date, reminders }).then(emitTasksChanged).catch(() => load())
  }

  const onToggle = async (task) => {
    if (task.done) { patch(task.id, { done: false }); updateTask(task.id, { done: false }).then(emitTasksChanged).catch(() => load()); return }
    const snapshot = tasksRef.current
    setTasks((ts) => ts.filter((t) => t.id !== task.id)) // optimistic remove with exit animation handled in CSS
    try {
      const r = await updateTask(task.id, { done: true })
      emitTasksChanged()
      if (r && r.done === false) {
        // Recurring: Vikunja keeps the task open and (if it can) bumps the due date.
        // If the date didn't actually advance (e.g. no due date set), it can never
        // complete — say so honestly instead of a misleading "Rescheduled".
        const advanced = isRealDate(r.due_date) && (!isRealDate(task.due_date) || new Date(r.due_date) > new Date(task.due_date))
        showUndo(advanced ? 'Rescheduled ↻' : 'Recurring — set a due date to complete', null)
        load()
      } else {
        showUndo('Completed', async () => { await updateTask(task.id, { done: false }).catch(() => {}); emitTasksChanged(); load() })
      }
    } catch { setTasks(snapshot) }
  }

  // Delete is permanent in Vikunja, so Undo re-creates the task (best effort:
  // core fields + reminders + labels). The restored task gets a new id.
  const onDelete = async (task) => {
    const snapshot = tasksRef.current
    setTasks((ts) => ts.filter((t) => t.id !== task.id))
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
        emitTasksChanged(); load()
      })
    } catch { setTasks(snapshot); load() }
  }

  return { tasks, state, load, setTasks, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo }
}
