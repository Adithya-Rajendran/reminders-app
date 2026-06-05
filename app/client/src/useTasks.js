import { useCallback, useEffect, useRef, useState } from 'react'
import { updateTask, schedulePreset } from './tasklib.js'

// Shared task-list behaviour: load, optimistic priority/due edits, and a
// recurring-aware completion with an Undo affordance. Used by Task List + Upcoming.
export function useTaskList(loader) {
  const [tasks, setTasks] = useState([])
  const [state, setState] = useState('loading')
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)

  const load = useCallback(async () => {
    setState((s) => (s === 'ready' ? s : 'loading'))
    try { const t = await loader(); setTasks(Array.isArray(t) ? t : []); setState('ready') } catch { setState('error') }
  }, [loader])
  useEffect(() => { load() }, [load])

  const patch = (id, p) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)))

  const showUndo = (label, fn) => {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }
  const dismissUndo = () => { clearTimeout(undoTimer.current); setUndo(null) }

  const onSetPriority = (task, priority) => { patch(task.id, { priority }); updateTask(task.id, { priority }).catch(() => load()) }
  const onSetDue = (task, key) => {
    const due = schedulePreset(key)
    patch(task.id, { due_date: due })
    updateTask(task.id, { due_date: due }).catch(() => load())
  }

  const onToggle = async (task) => {
    if (task.done) { patch(task.id, { done: false }); updateTask(task.id, { done: false }).catch(() => load()); return }
    const snapshot = tasks
    setTasks((ts) => ts.filter((t) => t.id !== task.id)) // optimistic remove with exit animation handled in CSS
    try {
      const r = await updateTask(task.id, { done: true })
      if (r && r.done === false) { showUndo('Rescheduled ↻', null); load() } // recurring: bumped due_date, reappears
      else showUndo('Completed', async () => { await updateTask(task.id, { done: false }).catch(() => {}); load() })
    } catch { setTasks(snapshot) }
  }

  return { tasks, state, load, setTasks, onToggle, onSetDue, onSetPriority, undo, dismissUndo }
}
