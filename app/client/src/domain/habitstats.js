// Pure habit consistency math over a task's X-REMINDERS-HABIT-LOG (an array of
// 'YYYY-MM-DD' completion days) + its recurrence cadence. No React/browser/api
// imports so the framework-free node tests cover it directly.
//
// Evidence-driven, forgiving by design: automaticity is keyed to ~66 days (not
// the 21-day myth), and streaks use a "don't-miss-twice" rule — a single missed
// occurrence never resets the streak to zero.
import { parseYmd } from './reviewstats.js'

const DAY = 864e5
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// Unique, ascending local-midnight ms for a habit's completion log.
export function logDays(habitLog) {
  const out = []
  for (const s of (habitLog || [])) { const d = parseYmd(s); if (!isNaN(d)) out.push(+startOfDay(d)) }
  return [...new Set(out)].sort((a, b) => a - b)
}

// Expected days between occurrences (daily habit => 1). Derived from repeat_after.
export function stepDaysOf(task) {
  const sec = Number(task && task.repeat_after) || 0
  return sec > 0 ? Math.max(1, Math.round(sec / 86400)) : 1
}

// Forgiving "don't-miss-twice" streak: count trailing completions spaced no more
// than two cadence steps apart. Today's not-yet-done slot is grace, not a miss
// (so the streak only breaks once you've missed two expected occurrences).
export function forgivingStreak(days, stepDays, now = new Date()) {
  if (!days.length) return 0
  const tol = 2 * stepDays * DAY
  const today = +startOfDay(now)
  if (today - days[days.length - 1] > tol) return 0 // two misses in a row → broken
  let streak = 1
  for (let i = days.length - 1; i > 0; i--) {
    if (days[i] - days[i - 1] <= tol) streak++
    else break
  }
  return streak
}

// Rolling consistency over the last `windowDays`: completed / expected, capped 100.
export function consistency(days, now, windowDays, stepDays) {
  const today = +startOfDay(now)
  const from = today - (windowDays - 1) * DAY
  const completed = days.filter((ms) => ms >= from && ms <= today).length
  const expected = Math.max(1, Math.round(windowDays / stepDays))
  return Math.min(100, Math.round((completed / expected) * 100))
}

// Last `n` calendar days as [{ ms, done }] (oldest first) for a dot strip.
export function recentDays(task, now = new Date(), n = 14) {
  const set = new Set(logDays(task && task.habit_log))
  const today = startOfDay(now)
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i)
    out.push({ ms: +d, done: set.has(+d) })
  }
  return out
}

export function computeHabitStats(task, now = new Date()) {
  const stepDays = stepDaysOf(task)
  const days = logDays(task && task.habit_log)
  const today = +startOfDay(now)
  const total = days.length
  const startMs = total ? days[0] : today
  // Calendar day-of-practice (1-based), capped horizon is 66 days to automaticity.
  const daysSinceStart = total ? Math.floor((today - startMs) / DAY) + 1 : 0
  return {
    stepDays,
    total,
    completedToday: total ? days[days.length - 1] === today : false,
    streak: forgivingStreak(days, stepDays, now),
    consistency30: total ? consistency(days, now, 30, stepDays) : 0,
    consistency66: total ? consistency(days, now, 66, stepDays) : 0,
    daysSinceStart,
    automaticityPct: Math.min(100, Math.round((daysSinceStart / 66) * 100)),
  }
}
