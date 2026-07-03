// Pure review-stats logic. Run with: node test/reviewstats.test.mjs
import { computeReview, startOfWeek, countCompletions, dailyTrend, weeklyPromptDue, parseYmd, weeklyTrend } from '../client/src/reviewstats.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Fixed "now": Tue 2026-06-16, local noon. This week (Mon-based) = Jun 15..21,
// last week = Jun 8..14.
const NOW = new Date(2026, 5, 16, 12, 0, 0)
const at = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h).toISOString()

// ---- startOfWeek (Monday) ----
ok(startOfWeek(NOW).getDate() === 15, 'startOfWeek: Tue Jun 16 -> Mon Jun 15')
ok(startOfWeek(new Date(2026, 5, 15, 0, 30)).getDate() === 15, 'startOfWeek: Mon stays Mon')
ok(startOfWeek(new Date(2026, 5, 21, 23, 0)).getDate() === 15, 'startOfWeek: Sun Jun 21 -> Mon Jun 15')

// ---- parseYmd is local, not UTC ----
{
  const d = parseYmd('2026-06-15')
  ok(d.getFullYear() === 2026 && d.getMonth() === 5 && d.getDate() === 15, 'parseYmd: local calendar day')
}

// ---- one-time + habit_log are both counted and disjoint ----
const tasks = [
  { id: 'a', done: true, done_at: at(2026, 6, 16) },                 // this week (one-time)
  { id: 'b', done: true, done_at: at(2026, 6, 10) },                 // last week (one-time)
  { id: 'c', done: false, done_at: '0001-01-01T00:00:00Z' },         // not done -> ignored
  { id: 'd', done: true, done_at: at(2026, 1, 1) },                  // far past -> not in week/30d
  { id: 'h', done: false, repeat_after: 86400, habit_log: ['2026-06-15', '2026-06-09', '2026-06-16'] },
]
const r = computeReview(tasks, NOW, null)
// this week: a (Jun16) + habit Jun15 + habit Jun16 = 3
ok(r.thisWeek === 3, `thisWeek counts one-time + habit-log (got ${r.thisWeek})`)
// last week: b (Jun10) + habit Jun9 = 2
ok(r.lastWeek === 2, `lastWeek counts one-time + habit-log (got ${r.lastWeek})`)
ok(r.deltaPct === 50, `deltaPct (3 vs 2) = 50 (got ${r.deltaPct})`)
ok(r.hasBaseline === true, 'hasBaseline true when last week > 0')

// ---- last7 trend shape + today's bucket ----
ok(r.last7.length === 7, 'last7 has 7 days')
ok(r.last7[6].date === '2026-06-16', 'last7 ends today')
ok(r.last7[6].count === 2, 'today bucket: one-time a + habit Jun16 = 2')
// 7-day window ending Jun16 reaches back to Jun10 inclusive: a(16)+habit(16)+habit(15)+b(10)=4 (habit Jun9 excluded)
ok(r.last7Total === 4, `last7Total = 4 (got ${r.last7Total})`)

// ---- 30-day total ----
// Within last 30 days of Jun 16: Jun16(x2), Jun15, Jun10, Jun9 = 5. Jan 1 excluded.
ok(r.last30Total === 5, `last30Total = 5 (got ${r.last30Total})`)

// ---- countCompletions range is half-open [from,to) ----
{
  const wk = startOfWeek(NOW)
  const next = new Date(wk); next.setDate(next.getDate() + 7)
  ok(countCompletions(tasks, wk, next) === 3, 'countCompletions matches thisWeek')
}

// ---- dailyTrend independent call ----
ok(dailyTrend(tasks, NOW, 30).length === 30, 'dailyTrend(30) has 30 entries')

// ---- weekly prompt ----
ok(weeklyPromptDue(NOW, null) === true, 'prompt due when never reviewed')
ok(weeklyPromptDue(NOW, at(2026, 6, 15)) === false, 'not due when reviewed this week (Mon)')
ok(weeklyPromptDue(NOW, at(2026, 6, 8)) === true, 'due when last review was last week')
ok(weeklyPromptDue(NOW, 'garbage') === true, 'due when last-reviewed is unparseable')
ok(r.promptDue === true, 'computeReview surfaces promptDue')

// ---- empty input is safe ----
{
  const e = computeReview([], NOW, null)
  // deltaPct is null (not 0) when there's no baseline: an honest "no comparison"
  // rather than a fake 0% or +100%.
  ok(e.thisWeek === 0 && e.lastWeek === 0, 'empty list -> zero counts')
  ok(e.deltaPct === null && e.hasBaseline === false, 'empty list -> no baseline, deltaPct null')
}

// ---- zero-baseline display logic: no divide-by-zero percentage ----
{
  // Completions this week only; nothing last week -> baseline is 0.
  const firstWeek = [
    { id: 'x', done: true, done_at: at(2026, 6, 16) },
    { id: 'y', done: true, done_at: at(2026, 6, 15) },
  ]
  const rz = computeReview(firstWeek, NOW, null)
  ok(rz.thisWeek === 2, `zero-baseline: thisWeek counted (got ${rz.thisWeek})`)
  ok(rz.lastWeek === 0, 'zero-baseline: lastWeek is 0')
  ok(rz.hasBaseline === false, 'zero-baseline: hasBaseline false')
  ok(rz.deltaPct === null, `zero-baseline: deltaPct null, not 100 (got ${rz.deltaPct})`)
}

// ---- weeklyTrend: bucketing over multiple weeks ----
{
  // Weeks (Mon-based) ending with this week (Jun15..21). 4 weeks back:
  //   wk0 May25..31, wk1 Jun1..7, wk2 Jun8..14, wk3 Jun15..21 (current)
  const wt = weeklyTrend([
    { id: 'a', done: true, done_at: at(2026, 6, 16) },              // wk3
    { id: 'b', done: true, done_at: at(2026, 6, 17) },              // wk3
    { id: 'c', done: true, done_at: at(2026, 6, 10) },              // wk2
    { id: 'd', done: false, habit_log: ['2026-06-02', '2026-06-05'] }, // wk1 x2
    { id: 'e', done: true, done_at: at(2026, 5, 26) },              // wk0
    { id: 'z', done: true, done_at: at(2026, 5, 20) },              // BEFORE window -> dropped
  ], NOW, 4)
  ok(wt.length === 4, `weeklyTrend length = weeks (got ${wt.length})`)
  ok(wt.map((w) => w.count).join(',') === '1,2,1,2', `weeklyTrend buckets (got ${wt.map((w) => w.count).join(',')})`)
  // weekStart is the Monday local-midnight ms of each bucket, oldest first, +7d apart.
  ok(new Date(wt[3].weekStart).getDate() === 15, 'weeklyTrend last bucket starts this Monday (Jun 15)')
  ok(new Date(wt[0].weekStart).getDate() === 25 && new Date(wt[0].weekStart).getMonth() === 4, 'weeklyTrend first bucket is May 25')
  ok(wt[3].weekStart - wt[2].weekStart === 7 * 86400000, 'weeklyTrend buckets are 7 days apart')
}

// ---- weeklyTrend: empty input -> all-zero buckets of the right shape ----
{
  const we = weeklyTrend([], NOW, 8)
  ok(we.length === 8, 'weeklyTrend(empty) has `weeks` buckets')
  ok(we.every((w) => w.count === 0), 'weeklyTrend(empty) all counts zero')
  ok(new Date(we[7].weekStart).getDate() === 15, 'weeklyTrend(empty) still ends on this Monday')
}

// ---- weeklyTrend: single week (weeks=1) -> just the current week ----
{
  const w1 = weeklyTrend([
    { id: 'a', done: true, done_at: at(2026, 6, 16) },  // this week
    { id: 'b', done: true, done_at: at(2026, 6, 10) },  // last week -> outside a 1-week window
  ], NOW, 1)
  ok(w1.length === 1, 'weeklyTrend(1) has a single bucket')
  ok(w1[0].count === 1, `weeklyTrend(1) counts only the current week (got ${w1[0].count})`)
  ok(new Date(w1[0].weekStart).getDate() === 15, 'weeklyTrend(1) bucket is this Monday')
}

// ---- weeklyTrend default matches computeReview.weekly ----
{
  ok(r.weekly.length === 8, `computeReview.weekly defaults to 8 weeks (got ${r.weekly.length})`)
  ok(r.weekly[7].count === r.thisWeek, 'computeReview.weekly last bucket == thisWeek')
}

console.log(`\nreviewstats.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
