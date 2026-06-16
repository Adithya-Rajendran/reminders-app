import { useCallback, useState } from 'react'
import { useTaskList } from '../useTasks.js'
import { selectCued } from '../taskviews.js'
import { createTask, parseQuickAdd } from '../tasklib.js'
import { emitTasksChanged } from '../tasksbus.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconCue, IconPlus } from '../icons.jsx'

// Implementation intentions ("when X, do Y"). Lists open tasks that carry a cue
// and lets you add new ones with the natural-language quick-add — this is the
// live home of parseQuickAdd, including the arrow cue token. Each row shows the
// editable cue chip (the trigger) next to the task (the action). Time-anchored
// cues are just tasks with a due date + reminder, so they reuse the VALARM feed.
export default function CuesWidget({ projects }) {
  const inboxId = projects?.[0]?.id
  const selector = useCallback((all) => selectCued(all), [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, onSetCue, undo, dismissUndo } = useTaskList(selector)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')

  const add = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    const parsed = parseQuickAdd(text)
    if (!parsed.title || !inboxId) return
    setErr(''); setDraft('')
    try {
      await createTask(inboxId, {
        title: parsed.title,
        priority: parsed.priority || 0,
        ...(parsed.due_date ? { due_date: parsed.due_date } : {}),
        ...(parsed.labels?.length ? { labels: parsed.labels } : {}),
        ...(parsed.cue ? { cue: parsed.cue } : {}),
      })
      emitTasksChanged(); load()
    } catch (e2) {
      setDraft(text)
      let msg = 'Could not add task.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (tasks.length === 0) {
    body = <EmptyState icon={IconCue} title="No cues yet" sub={inboxId ? 'Tie a task to a trigger: type “after morning erg -> draft figure”.' : 'Connect a CalDAV account in Settings to add tasks.'} />
  } else {
    body = (
      <div className="task-stream">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} onSetCue={onSetCue} />
        ))}
      </div>
    )
  }

  return (
    <div className="tasklist">
      {inboxId && (
        <form className="add-row qa" onSubmit={add}>
          <IconCue size={16} />
          <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="after morning erg -> draft figure" aria-label="Add a task with an if-then cue" />
          <button type="submit" className="iconbtn sm" aria-label="Add task" title="Add task"><IconPlus size={16} /></button>
        </form>
      )}
      {err && <div role="alert" className="rem-err">{err}</div>}
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
