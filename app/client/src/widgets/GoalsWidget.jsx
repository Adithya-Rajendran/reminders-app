import { useCallback, useMemo, useState } from 'react'
import { useTaskList } from '../useTasks.js'
import { computeGoals, childrenOf } from '../goalprogress.js'
import { createTask, parseQuickAdd } from '../tasklib.js'
import { emitTasksChanged } from '../tasksbus.js'
import TaskRow from './TaskRow.jsx'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconTarget, IconPlus } from '../icons.jsx'

// Lightweight goals: a goal is a parent VTODO (X-REMINDERS-GOAL=1); tasks link to
// it with RELATED-TO;RELTYPE=PARENT. Progress = % of linked children done. The
// new-goal form nudges specific/challenging phrasing, learning-vs-output, and one
// optional WOOP line (obstacle + if-then) stored in X-REMINDERS-GOAL-PLAN. Not OKRs.
function GoalCard({ g, tasks, inboxId, onReload, rowProps }) {
  const kids = childrenOf(tasks, g.uid)
  const [draft, setDraft] = useState('')
  const addChild = async (e) => {
    e.preventDefault()
    const parsed = parseQuickAdd(draft.trim())
    if (!parsed.title || !inboxId) return
    setDraft('')
    try {
      await createTask(inboxId, {
        title: parsed.title,
        priority: parsed.priority || 0,
        ...(parsed.due_date ? { due_date: parsed.due_date } : {}),
        ...(parsed.labels?.length ? { labels: parsed.labels } : {}),
        ...(parsed.cue ? { cue: parsed.cue } : {}),
        goal_uid: g.uid,
      })
      emitTasksChanged(); onReload()
    } catch { /* the next refresh reconciles */ }
  }
  return (
    <div className="goal">
      <div className="goal-head">
        <span className="goal-title">{g.title}</span>
        <span className="goal-pct">{g.progress}%</span>
      </div>
      <div className="goal-bar"><span className="goal-fill" style={{ width: `${g.progress}%` }} /></div>
      <div className="goal-sub">{g.done}/{g.total} tasks done</div>
      {g.plan && <div className="goal-plan">{g.plan}</div>}
      {kids.length > 0 && <div className="task-stream">{kids.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}</div>}
      {inboxId && (
        <form className="add-row qa goal-add" onSubmit={addChild}>
          <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a task toward this goal…" aria-label="Add a task to this goal" />
          <button type="submit" className="iconbtn sm" aria-label="Add task" title="Add task"><IconPlus size={16} /></button>
        </form>
      )}
    </div>
  )
}

export default function GoalsWidget({ projects }) {
  const inboxId = projects?.[0]?.id
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, undo, dismissUndo } = useTaskList(selector)
  const goals = useMemo(() => computeGoals(tasks), [tasks])

  const [showNew, setShowNew] = useState(false)
  const [gTitle, setGTitle] = useState('')
  const [gType, setGType] = useState('output') // 'learning' | 'output'
  const [gObstacle, setGObstacle] = useState('')
  const [gPlan, setGPlan] = useState('')
  const [err, setErr] = useState('')

  const composePlan = () => {
    const parts = [gType === 'learning' ? 'Learning goal.' : 'Output goal.']
    if (gObstacle.trim()) parts.push('Obstacle: ' + gObstacle.trim() + '.')
    if (gPlan.trim()) parts.push('If-then: ' + gPlan.trim() + '.')
    return parts.join(' ')
  }
  const createGoal = async (e) => {
    e.preventDefault()
    const title = gTitle.trim()
    if (!title || !inboxId) return
    setErr('')
    try {
      await createTask(inboxId, { title, is_goal: true, goal_plan: composePlan() })
      setGTitle(''); setGObstacle(''); setGPlan(''); setGType('output'); setShowNew(false)
      emitTasksChanged(); load()
    } catch (e2) {
      let msg = 'Could not create goal.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  const rowProps = { onToggle, onDelete, onSchedule, onSetPriority }

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (goals.length === 0) {
    body = <EmptyState icon={IconTarget} title="No goals yet" sub={inboxId ? 'Set a specific, challenging goal, then link tasks to it.' : 'Connect a CalDAV account in Settings to add goals.'} />
  } else {
    body = <div>{goals.map((g) => <GoalCard key={g.uid} g={g} tasks={tasks} inboxId={inboxId} onReload={load} rowProps={rowProps} />)}</div>
  }

  return (
    <div className="tasklist">
      {inboxId && (
        <div className="goal-new">
          {!showNew ? (
            <button className="btn ghost sm" onClick={() => setShowNew(true)}><IconPlus size={14} /> New goal</button>
          ) : (
            <form onSubmit={createGoal} className="goal-form">
              <input autoFocus className="input" value={gTitle} onChange={(e) => setGTitle(e.target.value)} placeholder="Specific &amp; challenging — e.g. “Run a sub-25 5K by Sept 1”" aria-label="Goal title" />
              <div className="goal-type">
                <button type="button" className={`chip${gType === 'output' ? ' active' : ''}`} onClick={() => setGType('output')}>Output number</button>
                <button type="button" className={`chip${gType === 'learning' ? ' active' : ''}`} onClick={() => setGType('learning')}>Learning</button>
              </div>
              <input className="input" value={gObstacle} onChange={(e) => setGObstacle(e.target.value)} placeholder="Biggest obstacle (optional)" aria-label="Obstacle" />
              <input className="input" value={gPlan} onChange={(e) => setGPlan(e.target.value)} placeholder="If [obstacle], then [plan] (optional)" aria-label="If-then plan" />
              <div className="goal-form-row">
                <button type="button" className="btn ghost sm" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" className="btn primary sm">Create goal</button>
              </div>
            </form>
          )}
        </div>
      )}
      {err && <div role="alert" className="rem-err">{err}</div>}
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
