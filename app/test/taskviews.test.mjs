// Pure task-view selectors shared by the Reminders/Upcoming widgets (they read
// from the single client task store). Run with: node test/taskviews.test.mjs
import { selectReminders, selectUpcoming, dueBucket, nextRemind, UPCOMING_ORDER, selectCued, hasCue, selectHabits, isRecurringTask, selectFrog, eisenhowerQuadrant, groupEisenhower, selectQuickWins, isQuickWin, isTwoMinName, selectFlowSource } from '../client/src/taskviews.js'
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

console.log(`\ntaskviews.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
