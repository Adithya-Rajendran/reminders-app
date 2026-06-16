// Pure habit-consistency math. Run with: node test/habitstats.test.mjs
import { computeHabitStats, forgivingStreak, consistency, recentDays, logDays, stepDaysOf } from '../client/src/habitstats.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Fixed "now": Tue 2026-06-16, local noon.
const NOW = new Date(2026, 5, 16, 12, 0, 0)
const DAY = 864e5
const ms = (y, mo, d) => +new Date(y, mo - 1, d) // local midnight

// ---- stepDaysOf ----
ok(stepDaysOf({ repeat_after: 86400 }) === 1, 'daily -> step 1')
ok(stepDaysOf({ repeat_after: 604800 }) === 7, 'weekly -> step 7')
ok(stepDaysOf({}) === 1, 'no repeat_after -> step 1 default')

// ---- logDays: parse, dedupe, sort ----
{
  const d = logDays(['2026-06-16', '2026-06-14', '2026-06-16', 'garbage', '2026-06-15'])
  ok(d.length === 3, 'logDays dedupes + drops invalid')
  ok(d[0] === ms(2026, 6, 14) && d[2] === ms(2026, 6, 16), 'logDays sorted ascending, local days')
}

// ---- forgivingStreak (daily, step 1, tol = 2 days) ----
const S = (arr) => forgivingStreak(arr.map((a) => ms(2026, 6, a)), 1, NOW)
ok(S([14, 15, 16]) === 3, 'three days incl today -> streak 3')
ok(S([14, 15]) === 2, 'today not yet done is grace, not a miss -> streak 2')
ok(S([12, 14, 15, 16]) === 4, 'a single interior miss (Jun13) does NOT reset -> streak 4')
ok(S([11, 14, 15, 16]) === 3, 'two consecutive misses (Jun12+13) break it -> streak 3')
ok(S([10]) === 0, 'last completion 6 days ago (missed twice) -> streak 0 (stale)')
ok(forgivingStreak([], 1, NOW) === 0, 'empty log -> streak 0')

// ---- forgivingStreak weekly (step 7, tol = 14 days) ----
{
  const w = [ms(2026, 6, 2), ms(2026, 6, 9), ms(2026, 6, 16)]
  ok(forgivingStreak(w, 7, NOW) === 3, 'weekly cadence: 7-day gaps keep the streak alive')
}

// ---- consistency ----
{
  const d = [ms(2026, 6, 14), ms(2026, 6, 15), ms(2026, 6, 16)]
  ok(consistency(d, NOW, 30, 1) === 10, 'daily: 3 of expected 30 -> 10%')
  ok(consistency(d, NOW, 66, 1) === 5, 'daily: 3 of expected 66 -> 5%')
}
{
  // consistency caps at 100 even if completions exceed naive expectation
  const many = []
  for (let i = 0; i < 40; i++) many.push(ms(2026, 6, 16) - i * DAY)
  ok(consistency(many, NOW, 30, 1) === 100, 'consistency capped at 100%')
}

// ---- recentDays ----
{
  const r = recentDays({ habit_log: ['2026-06-16', '2026-06-15'] }, NOW, 14)
  ok(r.length === 14, 'recentDays returns N entries')
  ok(r[13].done === true && r[12].done === true && r[11].done === false, 'recentDays marks the right trailing days done')
}

// ---- computeHabitStats end-to-end (daily) ----
{
  const s = computeHabitStats({ repeat_after: 86400, habit_log: ['2026-06-14', '2026-06-15', '2026-06-16'] }, NOW)
  ok(s.streak === 3 && s.completedToday === true, 'stats: streak 3, completed today')
  ok(s.daysSinceStart === 3, 'stats: day 3 of practice (Jun14..Jun16)')
  ok(s.automaticityPct === 5, 'stats: 3/66 days -> ~5% toward automaticity')
  ok(s.consistency30 === 10, 'stats: 30-day consistency 10%')
}
{
  const e = computeHabitStats({ repeat_after: 86400, habit_log: [] }, NOW)
  ok(e.total === 0 && e.streak === 0 && e.automaticityPct === 0 && e.completedToday === false, 'empty habit -> all zero')
}

console.log(`\nhabitstats.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
