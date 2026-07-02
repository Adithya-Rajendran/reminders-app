// Pure task-view selectors shared by the Reminders/Upcoming widgets (they read
// from the single client task store). Run with: node test/taskviews.test.mjs
import { selectReminders, selectUpcoming, selectStalled, dueBucket, nextRemind, UPCOMING_ORDER, selectCued, hasCue, selectHabits, isRecurringTask, selectFrog, selectFrogScored, byImportanceThenDue, eisenhowerQuadrant, groupEisenhower, selectQuickWins, isQuickWin, isTwoMinName, selectFlowSource, orderPlanFirst, selectTriagedThisWeek } from '../client/src/taskviews.js'
import { ZERO_DATE } from '../client/src/tasklib.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString()
const DAY = 864e5

// ---- nextRemind ----
ok(nextRemind({ reminders: [] }) === Infinity, 'nextRemind: no reminders -> Infinity')
ok(nextRemind({}) === Infinity, 'nextRemind: missing reminders -> Infinity')
{
  const a = iso(2 * DAY), b = iso(1 * DAY)
  ok(nextRemind({ reminders: [{ reminder: a }, { reminder: b }] }) === new Date(b).getTime(), 'nextRemind: picks the soonest reminder')
}

// ---- selectReminders ----
const remTasks = [
  { id: '1', done: false, reminders: [{ reminder: iso(3 * DAY) }], labels: [{ title: 'Work' }] },
  { id: '2', done: false, reminders: [{ reminder: iso(1 * DAY) }], labels: [{ title: 'Home' }] },
  { id: '3', done: true, reminders: [{ reminder: iso(1 * DAY) }] },          // done -> excluded
  { id: '4', done: false, reminders: [] },                                   // no reminder -> excluded
]
const allRem = selectReminders(remTasks)
ok(allRem.map((t) => t.id).join() === '2,1', 'selectReminders: open+reminded only, soonest first')
ok(selectReminders(remTasks, 'Work').map((t) => t.id).join() === '1', 'selectReminders: filters to a single group')
ok(selectReminders(remTasks, 'Nope').length === 0, 'selectReminders: unknown group -> empty')
// must not mutate the input array
const before = remTasks.map((t) => t.id).join()
selectReminders(remTasks)
ok(remTasks.map((t) => t.id).join() === before, 'selectReminders: does not reorder the source array')

// ---- selectUpcoming ----
const upTasks = [
  { id: 'a', done: false, due_date: iso(1 * DAY) },
  { id: 'b', done: true, due_date: iso(1 * DAY) },        // done -> excluded
  { id: 'c', done: false, due_date: ZERO_DATE },          // zero date -> excluded
  { id: 'd', done: false, due_date: '' },                 // no date -> excluded
]
ok(selectUpcoming(upTasks).map((t) => t.id).join() === 'a', 'selectUpcoming: open, real-dated only')

// ---- selectStalled (Weekly Review "get current") ----
const stalledTasks = [
  { id: 's1', done: false },                                              // no due, no reminder -> stalled
  { id: 's2', done: false, due_date: iso(1 * DAY) },                      // has due -> not stalled
  { id: 's3', done: false, reminders: [{ reminder: iso(1 * DAY) }] },     // has reminder -> not stalled
  { id: 's4', done: false, due_date: ZERO_DATE },                         // zero date counts as no date -> stalled
  { id: 's5', done: true },                                               // done -> excluded
  { id: 's6', done: false, is_goal: true },                              // goal -> excluded
]
ok(selectStalled(stalledTasks).map((t) => t.id).join() === 's1,s4', 'selectStalled: open, non-goal, no due AND no reminder')

// ---- selectCued / hasCue ----
const cueTasks = [
  { id: 'c1', done: false, cue: 'after morning erg' },
  { id: 'c2', done: false, cue: '   ' },          // whitespace-only -> not a cue
  { id: 'c3', done: false },                       // no cue
  { id: 'c4', done: true, cue: 'after lunch' },    // done -> excluded
  { id: 'c5', done: false, cue: 'before bed' },
]
ok(hasCue({ cue: 'x' }) === true && hasCue({ cue: '  ' }) === false && hasCue({}) === false, 'hasCue: non-empty trimmed cue only')
ok(selectCued(cueTasks).map((t) => t.id).join() === 'c1,c5', 'selectCued: open tasks with a real cue')

// ---- selectHabits / isRecurringTask ----
const habitTasks = [
  { id: 'h1', done: false, repeat_after: 86400 },     // daily -> habit
  { id: 'h2', done: false, repeat_mode: 1 },           // monthly mode -> habit
  { id: 'h3', done: false, repeat_mode: 2 },           // custom-from-completion -> habit
  { id: 'h4', done: false, repeat_after: 0 },          // not recurring
  { id: 'h5', done: true, repeat_after: 86400 },       // recurring but done (COUNT exhausted) -> excluded
]
ok(isRecurringTask({ repeat_after: 86400 }) === true && isRecurringTask({ repeat_after: 0 }) === false, 'isRecurringTask: repeat_after > 0')
ok(selectHabits(habitTasks).map((t) => t.id).join() === 'h1,h2,h3', 'selectHabits: open recurring tasks only')

// ---- selectFrog ----
const frogTasks = [
  { id: 'a', done: false, priority: 3, due_date: iso(2 * DAY) },
  { id: 'b', done: false, priority: 5, due_date: iso(3 * DAY) }, // top priority, later due
  { id: 'c', done: false, priority: 5, due_date: iso(1 * DAY) }, // top priority, nearer due -> frog
  { id: 'd', done: true, priority: 5, due_date: iso(0) },        // done -> excluded
  { id: 'e', is_goal: true, priority: 5 },                       // goal -> excluded
]
ok(selectFrog(frogTasks).id === 'c', 'selectFrog: highest priority, then nearest due')
ok(selectFrog([]) === null, 'selectFrog: empty -> null')
ok(selectFrog([{ id: 'z', done: true, priority: 5 }]) === null, 'selectFrog: all done -> null')
ok(selectFrog([{ id: 'x', done: false, priority: 2 }, { id: 'y', done: false, priority: 4 }]).id === 'y', 'selectFrog: no due dates -> highest priority wins')

// ---- selectFrogScored (priority + dread) ----
{
  const t = [
    { id: 'a', done: false, priority: 4, dread: 0, due_date: iso(1 * DAY) }, // score 4
    { id: 'b', done: false, priority: 3, dread: 3, due_date: iso(2 * DAY) }, // score 6 -> frog
    { id: 'c', done: false, priority: 5, dread: 0, due_date: iso(3 * DAY) }, // score 5
  ]
  ok(selectFrogScored(t).id === 'b', 'selectFrogScored: dread lifts an important-but-avoided task to the top')
  ok(selectFrogScored([]) === null, 'selectFrogScored: empty -> null')
  ok(selectFrogScored(frogTasks).id === selectFrog(frogTasks).id, 'selectFrogScored reduces to selectFrog when no dread present')
}

// ---- byImportanceThenDue (anti-urgency sort) ----
{
  const a = { id: 'a', priority: 3, due_date: iso(1 * DAY) } // nearer but less important
  const b = { id: 'b', priority: 5, due_date: iso(5 * DAY) }
  const c = { id: 'c', priority: 5, due_date: iso(2 * DAY) } // top priority, nearer due
  ok([a, b, c].slice().sort(byImportanceThenDue).map((t) => t.id).join() === 'c,b,a', 'byImportanceThenDue: priority desc, then nearest due (urgent-but-trivial does not lead)')
  const x = { id: 'x', priority: 0, due_date: iso(1 * DAY) }
  const y = { id: 'y', priority: 0 } // undated
  ok([y, x].slice().sort(byImportanceThenDue).map((t) => t.id).join() === 'x,y', 'byImportanceThenDue: at equal priority a dated task sorts before an undated one')
}

// ---- eisenhowerQuadrant ----
const NOW = new Date()
ok(eisenhowerQuadrant({ priority: 4, due_date: iso(1 * DAY) }, NOW).q === 'Q1', 'important + urgent -> Q1')
ok(eisenhowerQuadrant({ priority: 4, due_date: iso(5 * DAY) }, NOW).q === 'Q2', 'important + not urgent -> Q2')
ok(eisenhowerQuadrant({ priority: 1, due_date: iso(1 * DAY) }, NOW).q === 'Q3', 'not important + urgent -> Q3')
ok(eisenhowerQuadrant({ priority: 1 }, NOW).q === 'Q4', 'not important + no due -> Q4')
ok(eisenhowerQuadrant({ priority: 5, due_date: iso(-2 * DAY) }, NOW).q === 'Q1', 'overdue counts as urgent -> Q1')

// ---- groupEisenhower ----
{
  const g = groupEisenhower([
    { id: '1', priority: 5, due_date: iso(1 * DAY) },   // Q1
    { id: '2', priority: 4, due_date: iso(10 * DAY) },  // Q2
    { id: '3', priority: 0, due_date: iso(1 * DAY) },   // Q3
    { id: '4', priority: 0 },                           // Q4
    { id: '5', done: true, priority: 5, due_date: iso(0) }, // excluded
    { id: '6', is_goal: true, priority: 5 },            // excluded
  ], NOW)
  ok(g.Q1.length === 1 && g.Q2.length === 1 && g.Q3.length === 1 && g.Q4.length === 1, 'groupEisenhower buckets one per quadrant, excludes done/goals')
}

// ---- two-minute quick wins ----
ok(isTwoMinName('2min') && isTwoMinName('2 min') && isTwoMinName('2-Min'), 'isTwoMinName matches 2min / 2 min / 2-Min')
ok(!isTwoMinName('20min') && !isTwoMinName('admin'), 'isTwoMinName does not over-match')
ok(isQuickWin({ labels: [{ title: 'Work' }, { title: '2 min' }] }) === true, 'isQuickWin: a 2min label among others')
ok(isQuickWin({ labels: [{ title: 'Work' }] }) === false, 'isQuickWin: no 2min label')
{
  const qw = [
    { id: 'q1', done: false, labels: [{ title: '2min' }] },
    { id: 'q2', done: false, labels: [{ title: 'errand' }] },     // not tagged
    { id: 'q3', done: true, labels: [{ title: '2min' }] },         // done -> excluded
    { id: 'q4', done: false, labels: [{ title: '2-min' }] },
  ]
  ok(selectQuickWins(qw).map((t) => t.id).join() === 'q1,q4', 'selectQuickWins: open, 2min-tagged only')
}

// ---- selectFlowSource (Cues canvas source) ----
const flowTasks = [
  { id: 'f1', done: false, reminders: [{ reminder: iso(DAY) }] },               // reminder -> included
  { id: 'f2', done: false, cue: 'after standup' },                              // cue -> included
  { id: 'f3', done: false, flow: { x: 10, y: 20, to: [] } },                    // already placed -> included
  { id: 'f4', done: false },                                                    // nothing -> excluded
  { id: 'f5', done: true, reminders: [{ reminder: iso(DAY) }] },                // done -> excluded
  { id: 'f6', done: false, reminders: [{ reminder: iso(DAY) }], labels: [{ title: 'Work' }] },
]
ok(selectFlowSource(flowTasks).map((t) => t.id).join() === 'f1,f2,f3,f6', 'selectFlowSource: open reminders/cued/placed only')
ok(selectFlowSource(flowTasks, 'Work').map((t) => t.id).join() === 'f6', 'selectFlowSource: filters to a group')

// ---- dueBucket ----
// Anchor to local noon N days out so the buckets don't flip near midnight (a raw
// now+offset crosses the day boundary in the last hours of the day -> flaky CI).
const atDay = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString() }
ok(dueBucket(atDay(-2)).k === 'overdue', 'dueBucket: past -> overdue')
ok(dueBucket(atDay(0)).k === 'today', 'dueBucket: later today -> today')
ok(dueBucket(atDay(1)).k === 'tomorrow', 'dueBucket: ~+1 day -> tomorrow')
ok(dueBucket(atDay(3)).k === 'week', 'dueBucket: +3 days -> this week')
ok(dueBucket(atDay(10)).k === 'later', 'dueBucket: +10 days -> later')
ok(UPCOMING_ORDER.join() === 'overdue,today,tomorrow,week,later', 'UPCOMING_ORDER is the display order')

// ---- orderPlanFirst ----
{
  const tasks = [
    { id: 'a', done: false, priority: 2 },
    { id: 'b', done: false, priority: 3 },
    { id: 'c', done: false, priority: 1 },
    { id: 'd', done: false, priority: 4 },
  ]
  // Plan ids b and c: they should lead, in their original relative order
  const result = orderPlanFirst(tasks, ['b', 'c'])
  ok(result[0].id === 'b' && result[1].id === 'c', 'orderPlanFirst: plan ids lead in original order')
  ok(result[2].id === 'a' && result[3].id === 'd', 'orderPlanFirst: non-plan ids follow in original order')
  // null planIds = identity (no reordering)
  const nullResult = orderPlanFirst(tasks, null)
  ok(nullResult.map((t) => t.id).join() === 'a,b,c,d', 'orderPlanFirst: null planIds -> identity')
  // empty planIds = identity
  const emptyResult = orderPlanFirst(tasks, [])
  ok(emptyResult.map((t) => t.id).join() === 'a,b,c,d', 'orderPlanFirst: empty planIds -> identity')
  // done plan tasks are NOT forced first
  const withDone = [
    { id: 'x', done: true, priority: 5 },   // plan id but done -> stays in rest
    { id: 'y', done: false, priority: 1 },
  ]
  const doneResult = orderPlanFirst(withDone, ['x'])
  ok(doneResult[0].id === 'y' && doneResult[1].id === 'x', 'orderPlanFirst: done plan tasks are not promoted')
  // ids not in plan are unaffected in relative order
  const outsideResult = orderPlanFirst(tasks, ['d'])
  ok(outsideResult[0].id === 'd', 'orderPlanFirst: plan id goes first')
  ok(outsideResult.slice(1).map((t) => t.id).join() === 'a,b,c', 'orderPlanFirst: non-plan ids preserve their relative order')
}

// ---- selectTriagedThisWeek ----
{
  const atDay = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString() }
  const triageTasks = [
    // tomorrow + estimate -> included
    { id: 't1', done: false, time_estimate: 30, due_date: atDay(1) },
    // this week + estimate -> included
    { id: 't2', done: false, time_estimate: 60, due_date: atDay(4) },
    // today -> excluded (today/overdue are handled by DailyWidget's main logic)
    { id: 't3', done: false, time_estimate: 30, due_date: atDay(0) },
    // overdue -> excluded
    { id: 't4', done: false, time_estimate: 30, due_date: atDay(-1) },
    // later -> excluded
    { id: 't5', done: false, time_estimate: 30, due_date: atDay(10) },
    // tomorrow but no estimate -> excluded (not triaged)
    { id: 't6', done: false, time_estimate: 0, due_date: atDay(1) },
    // tomorrow + estimate but no real due_date -> excluded
    { id: 't7', done: false, time_estimate: 30, due_date: '' },
    // done -> excluded
    { id: 't8', done: true, time_estimate: 30, due_date: atDay(1) },
    // is_goal -> excluded
    { id: 't9', done: false, is_goal: true, time_estimate: 30, due_date: atDay(1) },
  ]
  const result = selectTriagedThisWeek(triageTasks).map((t) => t.id).sort()
  ok(result.join() === 't1,t2', 'selectTriagedThisWeek: tomorrow + this-week with estimate only; excludes today/overdue/later/no-estimate/no-date/done/goals')
  ok(selectTriagedThisWeek([]).length === 0, 'selectTriagedThisWeek: empty list -> empty')
  ok(selectTriagedThisWeek(null).length === 0, 'selectTriagedThisWeek: null -> empty')
}

console.log(`\ntaskviews.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
