import { useCallback } from 'react'
import { useTaskList } from '../useTasks.js'
import { selectHabits } from '../taskviews.js'
import { computeHabitStats, recentDays } from '../habitstats.js'
import { SkeletonRows, EmptyState, ErrorState, UndoBar } from './parts.jsx'
import { IconFlame, IconRefresh } from '../icons.jsx'

const DOTS = 14

// Surfaces recurring tasks as habits with a forgiving consistency view: a
// don't-miss-twice streak, rolling 30-day consistency, a last-14-day dot strip,
// and progress toward the ~66-day automaticity horizon. History is reconstructed
// from X-REMINDERS-HABIT-LOG — no new persistence. Completing advances the
// recurrence (existing path) and appends today's date to the log server-side.
function HabitRow({ task, onToggle }) {
  const s = computeHabitStats(task, new Date())
  const dots = recentDays(task, new Date(), DOTS)
  return (
    <div className="habit">
      <button
        className={`check-btn${s.completedToday ? ' on' : ''}`}
        role="checkbox"
        aria-checked={s.completedToday}
        aria-label={s.completedToday ? `Done today: ${task.title}` : `Complete today: ${task.title}`}
        title={s.completedToday ? 'Completed today' : 'Mark done for today'}
        onClick={() => onToggle(task)}
      />
      <div className="habit-main">
        <div className="habit-title">
          <span className="t">{task.title}</span>
          <span className={`habit-streak${s.streak > 0 ? ' on' : ''}`} title="Current streak (forgiving)">
            <IconFlame size={13} /> {s.streak}
          </span>
        </div>
        <div className="habit-dots" aria-hidden="true">
          {dots.map((d) => <span key={d.ms} className={`hdot${d.done ? ' done' : ''}`} />)}
        </div>
        <div className="habit-meta">
          <span className="chip">{s.consistency30}% · 30d</span>
          {s.total > 0 && <span className="habit-auto" title="Progress toward the ~66-day automaticity horizon">
            <span className="habit-auto-bar"><span className="habit-auto-fill" style={{ width: `${s.automaticityPct}%` }} /></span>
            day {Math.min(s.daysSinceStart, 66)}/66
          </span>}
        </div>
      </div>
    </div>
  )
}

export default function HabitsWidget() {
  const selector = useCallback((all) => selectHabits(all), [])
  const { tasks, state, load, onToggle, undo, dismissUndo } = useTaskList(selector)

  let body
  if (state === 'loading') body = <SkeletonRows />
  else if (state === 'error') body = <ErrorState onRetry={load} />
  else if (tasks.length === 0) {
    body = <EmptyState icon={IconRefresh} title="No habits yet" sub="Make a task repeat (daily/weekly) and it shows up here with a streak and consistency." />
  } else {
    body = <div className="task-stream">{tasks.map((t) => <HabitRow key={t.id} task={t} onToggle={onToggle} />)}</div>
  }

  return (
    <div className="tasklist">
      {body}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
