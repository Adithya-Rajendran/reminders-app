// Unit test for the CalDAV reminder poller's seed/fire/prune state machine.
// Pure logic with an injected `now` — no CalDAV server required. Run with:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/poller.test.mjs
import { evaluateUserTasks, pruneState, freshState } from '../server/valarm-poller.js'

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++ } else { fail++; console.error('  ✗ ' + msg) } }

const SUB = 'user-1'
const T0 = Date.parse('2026-06-07T12:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
const ZERO = '0001-01-01T00:00:00Z'

// Simulate one poller tick over a snapshot of tasks at time `now`.
function simTick(tasks, now, state) {
  state.live = new Set()
  const fires = evaluateUserTasks(SUB, tasks, now, state)
  pruneState(state)
  return fires
}
const rem = (id, ms, extra = {}) => ({ id, done: false, due_date: ZERO, reminders: [{ reminder: iso(ms) }], ...extra })

// A) Boot seed never replays a reminder already due at startup.
{
  const s = freshState()
  const tasks = [rem('a', T0 - 60_000)]
  ok(simTick(tasks, T0, s).length === 0, 'A: seed tick fires nothing for an already-due reminder')
  ok(simTick(tasks, T0 + 120_000, s).length === 0, 'A: post-seed, the seeded reminder never fires')
}

// B) A reminder that comes due AFTER seed fires exactly once.
{
  const s = freshState()
  const tasks = [rem('b', T0 + 30_000)]
  ok(simTick(tasks, T0, s).length === 0, 'B: seed tick — not yet due, no fire')
  const f = simTick(tasks, T0 + 60_000, s)
  ok(f.length === 1, 'B: fires once when the trigger crosses now')
  ok(f[0]?.payload?.event?.event_name === 'task.reminder', 'B: event_name is task.reminder')
  ok(f[0]?.payload?.event?.data?.task?.id === 'b', 'B: carries the task id')
  ok(f[0]?.payload?.event?.data?.task?.reminders?.[0]?.reminder === iso(T0 + 30_000), 'B: carries the trigger time')
  ok(simTick(tasks, T0 + 90_000, s).length === 0, 'B: does not fire again (at-most-once)')
}

// C) Overdue fires once, and re-fires only when the due date is rescheduled.
{
  const s = freshState()
  ok(simTick([{ id: 'c', done: false, due_date: iso(T0 + 1_000_000), reminders: [] }], T0, s).length === 0, 'C: seed — not overdue yet')
  const f1 = simTick([{ id: 'c', done: false, due_date: iso(T0 + 1_000_000), reminders: [] }], T0 + 2_000_000, s)
  ok(f1.length === 1 && f1[0].payload.event.event_name === 'task.overdue', 'C: fires overdue once when due passes')
  ok(simTick([{ id: 'c', done: false, due_date: iso(T0 + 1_000_000), reminders: [] }], T0 + 3_000_000, s).length === 0, 'C: no duplicate overdue for same due date')
  const f2 = simTick([{ id: 'c', done: false, due_date: iso(T0 + 2_500_000), reminders: [] }], T0 + 3_000_000, s)
  ok(f2.length === 1 && f2[0].payload.event.event_name === 'task.overdue', 'C: re-fires after reschedule to a new (past) due date')
  ok(s.overdue.size === 1, 'C: the stale overdue key was pruned (only the current one remains)')
}

// D) Prune drops dedup keys when a task disappears; a reappearing task can fire again.
{
  const s = freshState()
  const tasks = [rem('d', T0 + 30_000)]
  simTick(tasks, T0, s)                              // seed
  ok(simTick(tasks, T0 + 60_000, s).length === 1, 'D: fires once')
  ok(simTick([], T0 + 90_000, s).length === 0 && s.fired.size === 0, 'D: vanished task is pruned from the fired set')
  ok(simTick(tasks, T0 + 120_000, s).length === 1, 'D: a reappearing task with a past reminder fires again')
}

// E) A completed task never fires (reminder + overdue both in the past).
{
  const s = freshState()
  const done = [{ id: 'e', done: true, due_date: iso(T0 - 10_000), reminders: [{ reminder: iso(T0 - 10_000) }] }]
  ok(simTick(done, T0, s).length === 0, 'E: seed — done task ignored')
  ok(simTick(done, T0 + 60_000, s).length === 0, 'E: done task never fires')
  ok(s.fired.size === 0 && s.overdue.size === 0, 'E: done task leaves no dedup state')
}

// F) Multiple reminders on one task each fire once as they cross now.
{
  const s = freshState()
  const tasks = [{ id: 'f', done: false, due_date: ZERO, reminders: [{ reminder: iso(T0 + 30_000) }, { reminder: iso(T0 + 90_000) }] }]
  simTick(tasks, T0, s)
  ok(simTick(tasks, T0 + 60_000, s).length === 1, 'F: first reminder fires')
  ok(simTick(tasks, T0 + 120_000, s).length === 1, 'F: second reminder fires later')
  ok(simTick(tasks, T0 + 180_000, s).length === 0, 'F: neither fires a third time')
}

console.log(`\npoller.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
