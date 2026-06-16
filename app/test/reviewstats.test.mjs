// Pure review-stats logic. Run with: node test/reviewstats.test.mjs
import { computeReview, startOfWeek, countCompletions, dailyTrend, weeklyPromptDue, parseYmd } from '../client/src/reviewstats.js'

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
  ok(e.thisWeek === 0 && e.lastWeek === 0 && e.deltaPct === 0, 'empty list -> all zero')
}

console.log(`\nreviewstats.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
