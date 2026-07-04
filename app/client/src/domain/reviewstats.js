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

// Per-week completion counts for the last `weeks` weeks ending with the current
// (Monday-based) week, oldest first. Reuses completionDays so recurring
// habit-log dates and one-off done_at completions are bucketed identically to
// every other stat here (and stay double-count-free — see the file header).
//
// Each bucket is [weekStart, nextWeekStart): weekStart is a local-midnight ms
// so the widget can key/label bars without re-parsing. The final entry is the
// in-progress current week (still accumulating), which the widget emphasizes.
export function weeklyTrend(tasks, now = new Date(), weeks = 8) {
  const n = Math.max(1, weeks | 0)
  const curStart = startOfWeek(now)
  // Oldest bucket starts (n-1) weeks before this week's Monday. One completionDays
  // pass over the whole span, then a plain integer-division bucketing — O(events).
  const spanStart = new Date(curStart); spanStart.setDate(spanStart.getDate() - 7 * (n - 1))
  const nextWk = new Date(curStart); nextWk.setDate(nextWk.getDate() + 7)
  const counts = new Array(n).fill(0)
  // Bucket by calendar-week boundaries (true local Mondays), NOT a fixed 7*24h ms
  // stride: across a DST change a week is 167h/169h, so a fixed stride shifts a
  // late-week completion into the wrong bucket. Precompute each week's local
  // midnight start; place each completion day in the interval [bounds[i], bounds[i+1]).
  const bounds = []
  for (let i = 0; i < n; i++) { const w = new Date(spanStart); w.setDate(w.getDate() + 7 * i); bounds.push(+w) }
  bounds.push(+nextWk)
  for (const ms of completionDays(tasks, spanStart, nextWk)) {
    for (let i = 0; i < n; i++) { if (ms >= bounds[i] && ms < bounds[i + 1]) { counts[i]++; break } }
  }
  return counts.map((count, i) => ({ weekStart: bounds[i], count }))
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
// a multi-week trend, and whether the weekly review prompt should show.
export function computeReview(tasks, now = new Date(), lastReviewedISO = null, weeks = 8) {
  const wkStart = startOfWeek(now)
  const lastWkStart = new Date(wkStart); lastWkStart.setDate(lastWkStart.getDate() - 7)
  const nextWk = new Date(wkStart); nextWk.setDate(nextWk.getDate() + 7)
  const thisWeek = countCompletions(tasks, wkStart, nextWk)
  const lastWeek = countCompletions(tasks, lastWkStart, wkStart)
  // A percentage against a zero baseline is meaningless: "+100%" (or worse,
  // "+100% vs last week (0)") implies a doubling that never happened. When there's
  // nothing to compare against, `deltaPct` is null and the widget shows an honest
  // absolute count instead. hasBaseline is the single flag every consumer branches
  // on so the "no comparison possible" rule lives in one place.
  const hasBaseline = lastWeek > 0
  const deltaPct = hasBaseline ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null
  const last7 = dailyTrend(tasks, now, 7)
  const trend30 = dailyTrend(tasks, now, 30)
  const weekly = weeklyTrend(tasks, now, weeks)
  return {
    thisWeek,
    lastWeek,
    hasBaseline,
    deltaPct,
    last7,
    last7Total: last7.reduce((s, d) => s + d.count, 0),
    trend30,
    last30Total: trend30.reduce((s, d) => s + d.count, 0),
    weekly,
    promptDue: weeklyPromptDue(now, lastReviewedISO),
  }
}
