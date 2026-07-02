// The server-side daily plan (server/daily_plan.js): validation, roundtrip,
// idempotent add/remove, per-user isolation, old-day pruning. Real better-sqlite3
// file in a temp path (same recipe as config.sqlite.test.mjs). Run with:
//   node test/daily_plan.test.mjs
import { rmSync } from 'node:fs'

process.env.CONFIG_DB_PATH = process.env.DAILY_PLAN_TEST_DB || '/tmp/daily-plan.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const cfg = await import('../server/config.js')
const dp = await import('../server/daily_plan.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const throws400 = async (fn, m) => {
  try { await fn(); ok(false, m + ' (did not throw)') } catch (e) { ok(e.status === 400, m + ` (status ${e.status})`) }
}
const U = 'sub-alice', U2 = 'sub-bob'
const D = '2026-07-01', D2 = '2026-07-02'

// --- date + ids validation ---
ok(dp.DATE_RE.test('2026-07-01') && !dp.DATE_RE.test('2026-7-1') && !dp.DATE_RE.test('20260701'), 'DATE_RE accepts only YYYY-MM-DD')
ok(/^\d{4}-\d{2}-\d{2}$/.test(dp.todayYmd()), 'todayYmd is a YYYY-MM-DD string')
ok(dp.todayYmd(new Date(2026, 0, 5)) === '2026-01-05', 'todayYmd pads month/day')
await throws400(() => dp.getPlan(U, 'nope'), 'getPlan rejects a bad date')
await throws400(() => dp.setPlan(U, D, 'not-an-array'), 'setPlan rejects non-array ids')
await throws400(() => dp.setPlan(U, D, [42]), 'setPlan rejects non-string ids')
await throws400(() => dp.setPlan(U, D, ['']), 'setPlan rejects empty-string ids')
await throws400(() => dp.setPlan(U, D, ['x'.repeat(513)]), 'setPlan rejects oversized ids')
await throws400(() => dp.setPlan(U, D, Array.from({ length: 101 }, (_, i) => 'id-' + i)), 'setPlan rejects >100 ids')
ok(dp.cleanIds(['a', 'b', 'a', 'c', 'b']).join() === 'a,b,c', 'cleanIds dedupes, preserving first-occurrence order')

// --- roundtrip ---
ok((await dp.getPlan(U, D)).ids.length === 0, 'a fresh day has an empty plan')
const set1 = await dp.setPlan(U, D, ['t1', 't2'])
ok(set1.date === D && set1.ids.join() === 't1,t2', 'setPlan echoes the cleaned plan')
ok((await dp.getPlan(U, D)).ids.join() === 't1,t2', 'getPlan returns what was set')
ok((await dp.getPlan(U, D2)).ids.length === 0, 'a different day is independent')
ok((await dp.getPlan(U2, D)).ids.length === 0, 'plans are per-user')

// --- add/remove (idempotent) ---
await dp.addToPlan(U, D, 't3')
ok((await dp.getPlan(U, D)).ids.join() === 't1,t2,t3', 'addToPlan appends')
await dp.addToPlan(U, D, 't3')
ok((await dp.getPlan(U, D)).ids.join() === 't1,t2,t3', 'addToPlan is idempotent')
await dp.removeFromPlan(U, D, 't2')
ok((await dp.getPlan(U, D)).ids.join() === 't1,t3', 'removeFromPlan drops the id')
await dp.removeFromPlan(U, D, 't2')
ok((await dp.getPlan(U, D)).ids.join() === 't1,t3', 'removeFromPlan is idempotent')

// --- old-day pruning (opportunistic, per-user, on write) ---
await dp.setPlan(U, '2026-05-01', ['old'])
await dp.setPlan(U, '2026-07-10', ['new'])                       // write >14d later prunes 2026-05-01
ok((await dp.getPlan(U, '2026-05-01')).ids.length === 0, 'plans older than 14 days are pruned on write')
ok((await dp.getPlan(U, D)).ids.join() === 't1,t3', 'plans within the window survive the prune')
ok((await dp.getPlan(U, '2026-07-10')).ids.join() === 'new', 'the just-written plan survives its own prune')

// --- raw accessor tolerates corrupt rows ---
cfg.sqlite.prepare('UPDATE daily_plans SET ids_json=? WHERE user_id=? AND plan_date=?').run('{not json', U, '2026-07-10')
ok((await cfg.getDailyPlanIds(U, '2026-07-10')).length === 0, 'corrupt ids_json reads as an empty plan (never throws)')

console.log(`daily_plan: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
