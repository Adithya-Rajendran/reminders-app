// Pure task-view selectors shared by the Reminders/Upcoming widgets (they read
// from the single client task store). Run with: node test/taskviews.test.mjs
import { selectReminders, selectUpcoming, dueBucket, nextRemind, UPCOMING_ORDER, selectCued, hasCue } from '../client/src/taskviews.js'
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

// ---- dueBucket ----
ok(dueBucket(iso(-2 * DAY)).k === 'overdue', 'dueBucket: past -> overdue')
ok(dueBucket(iso(2 * 3600e3)).k === 'today', 'dueBucket: later today -> today')
ok(dueBucket(iso(1 * DAY + 3600e3)).k === 'tomorrow', 'dueBucket: ~+1 day -> tomorrow')
ok(dueBucket(iso(3 * DAY)).k === 'week', 'dueBucket: +3 days -> this week')
ok(dueBucket(iso(10 * DAY)).k === 'later', 'dueBucket: +10 days -> later')
ok(UPCOMING_ORDER.join() === 'overdue,today,tomorrow,week,later', 'UPCOMING_ORDER is the display order')

console.log(`\ntaskviews.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
