import React, { useCallback, useState } from 'react'
import { tk } from '../api.js'
import { useTaskList } from '../useTasks.js'
import { emitTasksChanged } from '../tasksbus.js'
import { parseQuickAdd, createTask, attachLabels } from '../tasklib.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconPlus } from '../icons.jsx'

export default function TaskListWidget({ projectId }) {
  const loader = useCallback(async () => {
    const all = await tk(`/projects/${projectId}/tasks?per_page=100`)
    return (Array.isArray(all) ? all : []).filter((t) => !t.done)
  }, [projectId])

  const { tasks, state, load, onToggle, onDelete, onSetDue, onSetPriority, undo, dismissUndo } = useTaskList(loader)
  const [draft, setDraft] = useState('')

  const add = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    const { title, priority, due_date, labels } = parseQuickAdd(text)
    try {
      const t = await createTask(projectId, { title: title || text, priority, ...(due_date ? { due_date } : {}) })
      if (labels.length && t?.id) await attachLabels(t.id, labels)
    } catch { /* fall through to reload */ }
    emitTasksChanged() // let Upcoming / Reminders / Calendar pick up the new task too
    load()
  }

  if (!projectId) return <EmptyState title="No project selected" />

  return (
    <div className="tasklist">
      <form className="add-row qa" onSubmit={add}>
        <IconPlus size={16} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…  (try “report tomorrow !2 *work”)"
          aria-label="Quick add task"
        />
      </form>
      {state === 'loading' && <SkeletonRows />}
      {state === 'error' && <ErrorState onRetry={load} />}
      {state === 'ready' && (tasks.length === 0
        ? <EmptyState title="All clear" sub="No open tasks. Add one above." />
        : <div className="task-stream">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onSetDue={onSetDue} onSetPriority={onSetPriority} />
            ))}
          </div>)}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
