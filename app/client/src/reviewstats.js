// Pure review/feedback stats over the shared task list (see taskstore.js).
// No React/browser/api imports, so the framework-free node tests cover it directly.
//
// A "completion" counts when EITHER a one-time task was completed in range
// (done + a real done_at) OR a habit-log date falls in range. The two sets are
// disjoint by construction: recurring tasks date-shift on completion and never
// persist STATUS:COMPLETED (so they carry no done_at), while one-time tasks
// never carry a habit_log — so the union is double-count-free.
import { isRealDate } from './tasklib.js'

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

// Parse a floating 'YYYY-MM-DD' as a LOCAL calendar day (not UTC) so habit-log
// dates bucket on the same day the user sees, regardless of timezone offset.
export const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN)
}
const ymd = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

// Monday-based start of the week containing `d`, at local midnight.
export function startOfWeek(d = new Date()) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7 // Mon=0 … Sun=6
  x.setDate(x.getDate() - dow)
  return x
}

// Local-midnight ms of every completion day from a task list within [from, to).
export function completionDays(tasks, from, to) {
  const lo = +from, hi = +to
  const out = []
  for (const t of (tasks || [])) {
    if (t.done && isRealDate(t.done_at)) {
      const ms = +startOfDay(t.done_at)
      if (ms >= lo && ms < hi) out.push(ms)
    }
    for (const iso of (t.habit_log || [])) {
      const d = parseYmd(iso)
      if (isNaN(d)) continue
      const ms = +d
      if (ms >= lo && ms < hi) out.push(ms)
    }
  }
  return out
}

export const countCompletions = (tasks, from, to) => completionDays(tasks, from, to).length

// Per-day counts for the last `days` days ending today (inclusive), oldest first.
export function dailyTrend(tasks, now = new Date(), days = 7) {
  const today = startOfDay(now)
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today); day.setDate(day.getDate() - i)
    const next = new Date(day); next.setDate(next.getDate() + 1)
    out.push({ date: ymd(day), count: countCompletions(tasks, day, next) })
  }
  return out
}

// The weekly review is "due" when no review has been recorded since the start
// of the current (Monday-based) week.
export function weeklyPromptDue(now = new Date(), lastReviewedISO = null) {
  if (!lastReviewedISO) return true
  const last = new Date(lastReviewedISO)
  if (isNaN(last)) return true
  return +last < +startOfWeek(now)
}

// One call for the widget: this-week vs last-week counts, a 7- and 30-day trend,
// and whether the weekly review prompt should show.
export function computeReview(tasks, now = new Date(), lastReviewedISO = null) {
  const wkStart = startOfWeek(now)
  const lastWkStart = new Date(wkStart); lastWkStart.setDate(lastWkStart.getDate() - 7)
  const nextWk = new Date(wkStart); nextWk.setDate(nextWk.getDate() + 7)
  const thisWeek = countCompletions(tasks, wkStart, nextWk)
  const lastWeek = countCompletions(tasks, lastWkStart, wkStart)
  const deltaPct = lastWeek === 0 ? (thisWeek > 0 ? 100 : 0) : Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
  const last7 = dailyTrend(tasks, now, 7)
  const trend30 = dailyTrend(tasks, now, 30)
  return {
    thisWeek,
    lastWeek,
    deltaPct,
    last7,
    last7Total: last7.reduce((s, d) => s + d.count, 0),
    trend30,
    last30Total: trend30.reduce((s, d) => s + d.count, 0),
    promptDue: weeklyPromptDue(now, lastReviewedISO),
  }
}
