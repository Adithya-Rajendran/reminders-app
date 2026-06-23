// Pure XP / leveling math for the Triage widget. No React/browser/api imports so
// the framework-free node tests cover it directly (test/leveling.test.mjs).
//
// Design stance — honest by construction, to fit this app's evidence-first ethos:
// XP is a PURE DERIVED VIEW over work the user actually completed (one-off tasks'
// done_at + recurring tasks' habit_log — the same two sources reviewstats.js
// unifies), weighted by importance × effort × dread. Weighting is the point: it
// rewards eating the frog and the hard, important, dreaded work — and makes XP
// un-farmable by churning trivial tasks (counters the "mere urgency effect",
// Zhu/Yang/Hsee 2018, and "default to easy work under load", KC & Staats 2020).
// There is deliberately no stored, mutable XP counter to drift or be gamed.
import { isRealDate } from './tasklib.js'
import { parseYmd, completionDays } from './reviewstats.js'

const DAY = 864e5
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// ---- per-task XP weighting ----
export const XP_BASE = 12

// Importance: PRIORITY 0..5 (None..DO NOW) → 1.0 .. 3.5×.
export const importanceFactor = (p) => 1 + clamp(Math.trunc(Number(p) || 0), 0, 5) * 0.5
// Effort: time_estimate (minutes) → √(min/30), clamped [0.6, 3]. Diminishing so a
// big task rewards more but can't dominate; NO estimate = neutral 1.0 (a task
// isn't penalised for being un-estimated — it just doesn't get the effort bonus).
export const effortFactor = (min) => {
  const m = Math.max(0, Math.trunc(Number(min) || 0))
  return m ? clamp(Math.sqrt(m / 30), 0.6, 3) : 1
}
// Dread: avoidance 0..5 → 1.0 .. 2.0× (the avoid-it-most work is worth the most).
export const dreadFactor = (d) => 1 + clamp(Math.trunc(Number(d) || 0), 0, 5) / 5

// XP earned for completing one task. A frog (P3·90m·dread4) ≈ 94; a trivial
// P0·5m task ≈ 7 — ~13× — so importance/effort/dread actually steer behaviour.
export const taskXp = (t) =>
  Math.round(XP_BASE * importanceFactor(t && t.priority) * effortFactor(t && t.time_estimate) * dreadFactor(t && t.dread))

// ---- completion XP over a date window ----
// XP-weighted analogue of reviewstats.completionDays: a one-off task contributes
// taskXp once on its done_at; a recurring task contributes taskXp for EACH
// habit_log day in range. The two sources are disjoint by construction (recurring
// tasks never carry STATUS:COMPLETED/done_at), so the sum never double-counts.
// from/to default to all-time (±∞) — careerXp() is the no-window convenience.
export function completionsXp(tasks, from = -Infinity, to = Infinity) {
  const lo = +from, hi = +to
  let xp = 0
  for (const t of (tasks || [])) {
    if (t.done && isRealDate(t.done_at)) {
      const ms = +startOfDay(t.done_at)
      if (ms >= lo && ms < hi) xp += taskXp(t)
    }
    for (const iso of (t.habit_log || [])) {
      const d = parseYmd(iso)
      if (isNaN(d)) continue
      const ms = +d
      if (ms >= lo && ms < hi) xp += taskXp(t)
    }
  }
  return xp
}
export const careerXp = (tasks) => completionsXp(tasks)

// ---- level curve ----
// Each level costs a bit more than the last: cost(L) = 100 + 40·(L-1), so the
// cumulative XP to REACH level L is threshold(L) = 20·(L-1)² + 80·(L-1). Level 1
// starts at 0. A gentle ramp (100, 140, 180, … per level) ≈ roughly one frog per
// early level, so progress feels earned without ever stalling.
const LEVEL_BASE = 100
const LEVEL_STEP = 40
export function levelThreshold(level) {
  const m = Math.max(0, Math.trunc(level) - 1)
  return (LEVEL_STEP / 2) * m * (m - 1) + LEVEL_BASE * m // = 20m² + 80m for the defaults
}
// Inverse of threshold(): largest level whose threshold ≤ xp. Closed form from the
// quadratic 20m² + 80m − xp = 0 (m = L−1), floored. Guarded for xp ≤ 0 → level 1.
export function levelForXp(xp) {
  const x = Math.max(0, Number(xp) || 0)
  const a = LEVEL_STEP / 2, b = LEVEL_BASE - LEVEL_STEP / 2 // 20m² + 80m form
  const m = (-b + Math.sqrt(b * b + 4 * a * x)) / (2 * a)
  return Math.floor(m + 1e-9) + 1
}
// Progress within the current level, for the XP bar.
export function levelProgress(xp) {
  const x = Math.max(0, Number(xp) || 0)
  const level = levelForXp(x)
  const base = levelThreshold(level)
  const span = levelThreshold(level + 1) - base
  const into = x - base
  return { level, into, span, toNext: span - into, pct: span > 0 ? Math.round((into / span) * 100) : 0 }
}

// ---- daily activity streak ----
// Consecutive days (ending today) with ≥1 completion. Today is GRACE: a day with
// nothing done yet doesn't break the streak, it just isn't counted until you act.
export function dailyStreak(tasks, now = new Date()) {
  const today = +startOfDay(now)
  // Reuse reviewstats.completionDays — the single source of truth for the disjoint
  // done_at + habit-log day union and local-midnight bucketing.
  const set = new Set(completionDays(tasks, today - 366 * DAY, today + DAY))
  let day = set.has(today) ? today : today - DAY
  let streak = 0
  while (set.has(day)) { streak++; day -= DAY }
  return streak
}

// ---- tuning constants the widget reads ----
export const DAILY_GOAL_DEFAULT = 3   // completions/day for a "full" goal ring
export const TRIAGE_XP = 5            // bonus for fully triaging a task (estimate + schedule)
export const TRIAGE_DAILY_CAP = 50    // …capped per day so triaging can't be farmed
