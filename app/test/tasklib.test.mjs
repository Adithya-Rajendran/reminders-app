// Characterization test for the client task helpers (pure, no DOM/network):
// isRealDate, dueChip, timeLabel, parseQuickAdd, pdotClass, ZERO_DATE.
// Locks today's actual output so a future refactor that drifts is caught. Run with:
//   docker run --rm -v /home/ubuntu/claude/reminders-app/app:/app -w /app -e CONFIG_STORE=sqlite -e CONFIG_DB_PATH=/tmp/tasklib.test.db node:22 node test/tasklib.test.mjs
import { parseQuickAdd, cueTriggerOf, dueChip, timeLabel, absDate, isRealDate, pdotClass, ZERO_DATE } from '../client/src/tasklib.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// A Date at local NOON shifted N days from now (noon dodges midnight/DST edges).
const dayShift = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d }
const localYMD = (dt) => `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// --- ZERO_DATE constant ---
ok(ZERO_DATE === '0001-01-01T00:00:00Z', 'ZERO_DATE is the Vikunja zero sentinel')

// --- isRealDate ---
ok(isRealDate(null) === false, 'isRealDate(null) is false')
ok(isRealDate('') === false, "isRealDate('') is false")
ok(isRealDate(ZERO_DATE) === false, 'isRealDate(ZERO_DATE) is false')
ok(isRealDate('garbage') === false, "isRealDate('garbage') is false")
ok(isRealDate('2026-06-08T10:00:00Z') === true, 'isRealDate(real ISO) is true')
ok(isRealDate(new Date(2026, 5, 8, 10, 0, 0).toISOString()) === true, 'isRealDate(real Date.toISOString()) is true')

// --- dueChip: null when not a real date ---
ok(dueChip(null) === null, 'dueChip(null) is null')
ok(dueChip(ZERO_DATE) === null, 'dueChip(ZERO_DATE) is null')

// --- dueChip: label + urgency class relative to today ---
const c0 = dueChip(dayShift(0))
ok(c0.label === 'Today' && c0.cls === 'due-soon', "N=0 -> 'Today' / 'due-soon'")
const c1 = dueChip(dayShift(1))
ok(c1.label === 'Tomorrow' && c1.cls === 'due-soon', "N=1 -> 'Tomorrow' / 'due-soon'")
const cm1 = dueChip(dayShift(-1))
ok(cm1.label === 'Yesterday' && cm1.cls === 'overdue', "N=-1 -> 'Yesterday' / 'overdue'")
const cm3 = dueChip(dayShift(-3))
ok(cm3.label === '3d ago' && cm3.cls === 'overdue', "N=-3 -> '3d ago' / 'overdue'")
const d3 = dayShift(3)
const c3 = dueChip(d3)
ok(c3.label === SHORT[d3.getDay()] && c3.cls === '', "N=3 -> exact weekday abbrev / '' (within the week)")
const d20 = dayShift(20)
const c20 = dueChip(d20)
ok(c20.label === `${MON[d20.getMonth()]} ${d20.getDate()}` && /^[A-Z][a-z]{2} \d{1,2}$/.test(c20.label) && c20.cls === '', "N=20 -> exact 'Mon D' / ''")

// --- timeLabel: local wall-clock formatting ---
ok(timeLabel(null) === '', 'timeLabel(non-real) is empty string')
ok(timeLabel(new Date(2026, 5, 8, 15, 0)) === '3:00 PM', '15:00 -> 3:00 PM')
ok(timeLabel(new Date(2026, 5, 8, 9, 5)) === '9:05 AM', '09:05 -> 9:05 AM')
ok(timeLabel(new Date(2026, 5, 8, 0, 0)) === '', 'midnight 00:00 -> empty (all-day)')
ok(timeLabel(new Date(2026, 5, 8, 12, 0)) === '12:00 PM', '12:00 -> 12:00 PM')
ok(timeLabel(new Date(2026, 5, 8, 0, 30)) === '12:30 AM', '00:30 -> 12:30 AM')

// --- absDate: full absolute date tooltip, time only when set ---
ok(absDate(null) === '' && absDate(ZERO_DATE) === '', 'absDate(non-real) is empty')
{
  const dt = new Date(2026, 5, 8, 15, 0) // Jun 8 2026, 3:00 PM local
  ok(absDate(dt.toISOString()) === `${SHORT[dt.getDay()]}, Jun ${dt.getDate()}, 2026, 3:00 PM`, 'absDate: weekday, Mon D, YYYY, time')
  const allday = new Date(2026, 5, 8, 0, 0)
  ok(absDate(allday.toISOString()) === `${SHORT[allday.getDay()]}, Jun ${allday.getDate()}, 2026`, 'absDate: midnight omits the time')
}

// --- parseQuickAdd ---
const q1 = parseQuickAdd('Submit report !2 *finance')
ok(q1.title === 'Submit report' && q1.priority === 2 &&
  JSON.stringify(q1.labels) === JSON.stringify(['finance']) && q1.due_date === undefined,
  "'Submit report !2 *finance' -> title/priority 2/labels [finance]/no due")

const q2 = parseQuickAdd('Email *work *urgent boss')
ok(q2.title === 'Email boss' && q2.priority === 0 &&
  JSON.stringify(q2.labels) === JSON.stringify(['work', 'urgent']) && q2.due_date === undefined,
  "'Email *work *urgent boss' -> title 'Email boss', labels exactly [work,urgent], priority 0")

const q3 = parseQuickAdd('Plain text')
ok(q3.title === 'Plain text' && q3.priority === 0 &&
  JSON.stringify(q3.labels) === JSON.stringify([]) && q3.due_date === undefined,
  "'Plain text' -> bare title, priority 0, no labels, no due")

const q4 = parseQuickAdd('Pay rent tomorrow')
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
ok(q4.title === 'Pay rent' && isRealDate(q4.due_date) &&
  localYMD(new Date(q4.due_date)) === localYMD(tomorrow),
  "'Pay rent tomorrow' -> title 'Pay rent', due local date == tomorrow")

const q5 = parseQuickAdd('Standup today')
ok(q5.title === 'Standup' && isRealDate(q5.due_date) &&
  localYMD(new Date(q5.due_date)) === localYMD(new Date()),
  "'Standup today' -> title 'Standup', due local date == today")

const q6 = parseQuickAdd('Task !7')
ok(q6.priority === 0 && q6.title === 'Task !7', "'Task !7' -> !7 not a valid priority (stays 0) and is NOT stripped from title")

// --- parseQuickAdd: if-then cue (arrow token) ---
const cue1 = parseQuickAdd('after morning erg -> draft figure')
ok(cue1.cue === 'after morning erg' && cue1.title === 'draft figure',
  "'after morning erg -> draft figure' -> cue/title split on the arrow")

const cue2 = parseQuickAdd('after standup -> email boss tomorrow !2 *work')
ok(cue2.cue === 'after standup' && cue2.title === 'email boss' && cue2.priority === 2 &&
  JSON.stringify(cue2.labels) === JSON.stringify(['work']) && isRealDate(cue2.due_date),
  'cue split, then date/priority/label tokens parsed from the right side')

const cue3 = parseQuickAdd('after lunch → walk the dog')
ok(cue3.cue === 'after lunch' && cue3.title === 'walk the dog', 'unicode arrow → also splits the cue')

const cue4 = parseQuickAdd('Plain task no arrow')
ok(cue4.cue === undefined && cue4.title === 'Plain task no arrow', 'no arrow -> no cue field')

const cue5 = parseQuickAdd('-> just do it')
ok(cue5.cue === undefined, 'arrow with an empty trigger -> no cue')

const cue6 = parseQuickAdd('after gym -> stretch -> cooldown')
ok(cue6.cue === 'after gym' && cue6.title === 'stretch -> cooldown', 'only the FIRST arrow splits the cue from the task')

// --- cueTriggerOf: classify a free-text cue into a typed trigger ---
ok(cueTriggerOf('') === null && cueTriggerOf('   ') === null, 'cueTriggerOf: blank -> null')
ok(cueTriggerOf('after standup').kind === 'after', 'after-prefix -> after')
ok(cueTriggerOf('at 9am').kind === 'time', 'clock time -> time')
ok(cueTriggerOf('tomorrow morning').kind === 'time', 'time-of-day word -> time')
ok(cueTriggerOf('when I arrive at the office').kind === 'location', 'arrival phrase -> location')
ok(cueTriggerOf('at the gym').kind === 'location', 'place phrase -> location')
ok(cueTriggerOf('after lunch at 1pm').kind === 'after', 'explicit "after" wins over a time mention')
ok(cueTriggerOf('finish the thing').kind === 'after', 'plain text -> after default')
ok(cueTriggerOf('  at 9am  ').value === 'at 9am', 'cueTriggerOf trims the value')
// parseQuickAdd now also returns the derived trigger when a cue is present
{
  const p = parseQuickAdd('at 9am -> draft figure')
  ok(p.cue === 'at 9am' && p.cue_trigger && p.cue_trigger.kind === 'time', 'parseQuickAdd attaches a typed cue_trigger')
  ok(parseQuickAdd('plain task').cue_trigger === undefined, 'no cue -> no cue_trigger field')
}

// --- pdotClass ---
ok(pdotClass(5) === 'p1' && pdotClass(4) === 'p1', 'pdotClass 5 and 4 -> p1')
ok(pdotClass(3) === 'p2', 'pdotClass 3 -> p2')
ok(pdotClass(1) === 'p3', 'pdotClass 1 -> p3')
ok(pdotClass(0) === 'p4', 'pdotClass 0 -> p4')

console.log(`\ntasklib.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
