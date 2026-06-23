// Pure XP / leveling math (client/src/leveling.js) — framework-free node test.
import {
  taskXp, importanceFactor, effortFactor, dreadFactor,
  completionsXp, careerXp, levelThreshold, levelForXp, levelProgress, dailyStreak,
  XP_BASE,
} from '../client/src/leveling.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

// ---- factor bounds ----
ok(importanceFactor(0) === 1 && importanceFactor(5) === 3.5, 'importanceFactor: 0→1, 5→3.5')
ok(importanceFactor(99) === 3.5 && importanceFactor(-3) === 1, 'importanceFactor clamps 0..5')
ok(effortFactor(0) === 1, 'effortFactor: no estimate → neutral 1')
ok(effortFactor(30) === 1, 'effortFactor: 30m → 1')
ok(approx(effortFactor(120), 2), 'effortFactor: 120m → 2')
ok(effortFactor(5) === 0.6, 'effortFactor: tiny clamps to 0.6 floor')
ok(effortFactor(100000) === 3, 'effortFactor: huge clamps to 3 ceiling')
ok(dreadFactor(0) === 1 && dreadFactor(5) === 2, 'dreadFactor: 0→1, 5→2')

// ---- taskXp ordering: the frog must dwarf the trivial task ----
const frog = { priority: 3, time_estimate: 90, dread: 4 }
const trivial = { priority: 0, time_estimate: 5, dread: 0 }
ok(taskXp(frog) > taskXp(trivial) * 8, `weighted XP: frog (${taskXp(frog)}) ≫ trivial (${taskXp(trivial)})`)
ok(taskXp({}) === XP_BASE, 'taskXp of a bare task = base (all factors neutral)')
ok(taskXp(trivial) > 0, 'taskXp never zero for a real completion')

// ---- completionsXp: one-off done_at + habit_log, windowed, no double-count ----
// Use floating (no-Z) timestamps + local-midnight window bounds so day-bucketing
// (which is local, like reviewstats.completionDays) is timezone-stable in CI.
const midnight = (s) => new Date(s + 'T00:00:00')
const tasks = [
  { id: 'a', done: true, done_at: '2026-06-20T10:00:00', priority: 3, time_estimate: 90, dread: 4 }, // ~94
  { id: 'b', done: true, done_at: '2026-06-21T10:00:00', priority: 0, time_estimate: 5, dread: 0 },  // ~7
  { id: 'c', done: false, priority: 5, time_estimate: 120, dread: 5 },                                 // open → 0
  { id: 'h', repeat_after: 86400, habit_log: ['2026-06-20', '2026-06-21'], priority: 1, time_estimate: 15, dread: 0 },
]
const xpAll = careerXp(tasks)
ok(xpAll === taskXp(tasks[0]) + taskXp(tasks[1]) + 2 * taskXp(tasks[3]), 'careerXp sums one-off + each habit day, skips open')
const only20 = completionsXp(tasks, midnight('2026-06-20'), midnight('2026-06-21'))
ok(only20 === taskXp(tasks[0]) + taskXp(tasks[3]), 'completionsXp windows to a single day (a + 1 habit day)')
ok(completionsXp([]) === 0 && completionsXp(null) === 0, 'completionsXp tolerates empty/null')

// ---- level curve: monotonic, known thresholds, inverse agrees ----
ok(levelThreshold(1) === 0, 'levelThreshold(1) = 0')
ok(levelThreshold(2) === 100, 'levelThreshold(2) = 100')
ok(levelThreshold(3) === 240, 'levelThreshold(3) = 240')
ok(levelThreshold(4) === 420, 'levelThreshold(4) = 420')
let mono = true
for (let L = 1; L < 60; L++) if (levelThreshold(L + 1) - levelThreshold(L) <= 0) mono = false
ok(mono, 'levelThreshold strictly increases (each level costs more)')
ok(levelForXp(0) === 1 && levelForXp(-5) === 1, 'levelForXp: 0/negative → level 1')
ok(levelForXp(99) === 1 && levelForXp(100) === 2 && levelForXp(239) === 2 && levelForXp(240) === 3, 'levelForXp matches thresholds at boundaries')
let inverseOk = true
for (let L = 1; L < 60; L++) {
  if (levelForXp(levelThreshold(L)) !== L) inverseOk = false
  if (levelForXp(levelThreshold(L + 1) - 1) !== L) inverseOk = false
}
ok(inverseOk, 'levelForXp is the exact inverse of levelThreshold across the range')

// ---- levelProgress ----
const p = levelProgress(170) // level 2 (240 next): into 70 of span 140 → 50%
ok(p.level === 2 && p.into === 70 && p.span === 140 && p.toNext === 70 && p.pct === 50, 'levelProgress reports into/span/toNext/pct')
ok(levelProgress(0).pct === 0 && levelProgress(0).level === 1, 'levelProgress at 0 xp')

// ---- dailyStreak: today is grace; counts consecutive days back ----
const now = midnight('2026-06-22')
const streakTasks = [
  { done: true, done_at: '2026-06-21T09:00:00' },
  { done: true, done_at: '2026-06-20T09:00:00' },
  // gap on 06-19
  { done: true, done_at: '2026-06-17T09:00:00' },
]
ok(dailyStreak(streakTasks, now) === 2, 'dailyStreak: nothing today (grace) → counts 21,20 then gap → 2')
ok(dailyStreak([{ done: true, done_at: '2026-06-22T09:00:00' }, ...streakTasks], now) === 3, 'dailyStreak: completing today extends to 3')
ok(dailyStreak([], now) === 0, 'dailyStreak: no completions → 0')

console.log(`leveling: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
