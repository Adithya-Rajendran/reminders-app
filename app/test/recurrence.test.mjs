// Characterization test for server/recurrence_caldav.js — the RRULE/X-prop
// recurrence engine over a single evolving ICAL VTODO. Locks: writing repeat
// fields (DAILY/WEEKLY/HOURLY/interval + MONTHLY mode 1 + custom mode 2),
// the seconds<->freq round-trip, on-completion advance (date-shift of
// DTSTART/DUE, COUNT exhaustion -> COMPLETED, mode-2 DUE bump, absolute VALARM
// shift). The docker run is the oracle; assertions lock ACTUAL current output.
// Run with:
//   docker run --rm -v /home/ubuntu/claude/reminders-app/app:/app -w /app -e CONFIG_STORE=sqlite -e CONFIG_DB_PATH=/tmp/recurrence.test.db node:22 node test/recurrence.test.mjs
import ICAL from 'ical.js'
import {
  advanceRecurringVtodo, applyRepeatFields, repeatFieldsFromVtodo,
  isRecurring, hasCustomFromCompletion
} from '../server/recurrence_caldav.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const ANCHOR_ISO = '2026-06-08T09:00:00Z'
const NOW_ISO = '2026-06-08T12:00:00Z'
const t = (iso) => ICAL.Time.fromJSDate(new Date(iso), true)
const now = t(NOW_ISO)
const iso = (vt, prop) => vt.getFirstProperty(prop).getFirstValue().toJSDate().toISOString()

// A VTODO anchored at 2026-06-08T09:00Z on both DTSTART and DUE (same instant).
function makeVt() {
  const vt = new ICAL.Component('vtodo')
  vt.updatePropertyWithValue('dtstart', t(ANCHOR_ISO))
  vt.updatePropertyWithValue('due', t(ANCHOR_ISO))
  return vt
}

// --- applyRepeatFields mode 0 writes an RRULE; ensureAnchor backfills DTSTART ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 86400, 0)
  const recur = vt.getFirstProperty('rrule').getFirstValue()
  ok(recur.freq === 'DAILY', 'applyRepeatFields(_,86400,0) sets RRULE FREQ=DAILY')
  ok((recur.interval || 1) === 1, 'applyRepeatFields(_,86400,0) sets INTERVAL=1')

  const bare = new ICAL.Component('vtodo') // no dtstart, no due
  applyRepeatFields(bare, 86400, 0)
  ok(!!bare.getFirstProperty('dtstart'), 'ensureAnchor adds a DTSTART when none is present')
}

// --- secondsToFreq round-trip through repeatFieldsFromVtodo (fresh vt per case) ---
// Also pin the ACTUAL FREQ/INTERVAL secondsToFreq chooses, so the round-trip
// can't pass with a self-consistent-but-wrong unit (e.g. 604800 as DAILY;7).
const expectFreq = {
  86400:  { freq: 'DAILY',  interval: 1 },
  604800: { freq: 'WEEKLY', interval: 1 },
  3600:   { freq: 'HOURLY', interval: 1 },
  172800: { freq: 'DAILY',  interval: 2 },
}
for (const after of [86400, 604800, 3600, 172800]) {
  const vt = makeVt()
  applyRepeatFields(vt, after, 0)
  const recur = vt.getFirstProperty('rrule').getFirstValue()
  const e = expectFreq[after]
  ok(recur.freq === e.freq && (recur.interval || 1) === e.interval,
    `after=${after} writes RRULE FREQ=${e.freq} INTERVAL=${e.interval} (got ${recur.freq}/${recur.interval || 1})`)
  const r = repeatFieldsFromVtodo(vt)
  ok(r.repeat_after === after && r.repeat_mode === 0,
    `round-trip after=${after} -> {repeat_after:${after}, repeat_mode:0} (got ${r.repeat_after}/${r.repeat_mode})`)
}

// --- mode 1: MONTHLY RRULE; reads back as the ~30.44d MONTH_SECONDS badge ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 0, 1)
  const recur = vt.getFirstProperty('rrule').getFirstValue()
  ok(recur.freq === 'MONTHLY' && (recur.interval || 1) === 1, 'mode 1 sets RRULE FREQ=MONTHLY INTERVAL=1')
  const r = repeatFieldsFromVtodo(vt)
  ok(r.repeat_after === 2629800 && r.repeat_mode === 1, 'mode 1 reads back {repeat_after:2629800, repeat_mode:1}')
  ok(isRecurring(vt) === true, 'mode 1 vtodo isRecurring (has rrule)')
}

// --- mode 2: no RRULE, X-props instead; custom-from-completion ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 3600, 2)
  ok(!vt.getFirstProperty('rrule'), 'mode 2 sets NO rrule')
  ok(vt.getFirstPropertyValue('x-reminders-repeat-mode') === '2', 'mode 2 sets x-reminders-repeat-mode=2')
  ok(Number(vt.getFirstPropertyValue('x-reminders-repeat-after')) === 3600, 'mode 2 sets x-reminders-repeat-after=3600')
  ok(hasCustomFromCompletion(vt) === true, 'mode 2 hasCustomFromCompletion')
  ok(isRecurring(vt) === true, 'mode 2 isRecurring')
  const r = repeatFieldsFromVtodo(vt)
  ok(r.repeat_after === 3600 && r.repeat_mode === 2, 'mode 2 reads back {repeat_after:3600, repeat_mode:2}')

  const vt0 = makeVt()
  applyRepeatFields(vt0, 0, 2) // after<=0 -> sets nothing
  ok(!hasCustomFromCompletion(vt0) && !isRecurring(vt0), 'mode 2 with after<=0 sets nothing (not recurring)')
}

// --- after<=0 + mode 0 clears any prior repeat ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 86400, 0) // first arm it
  applyRepeatFields(vt, 0, 0)     // then clear
  const r = repeatFieldsFromVtodo(vt)
  ok(r.repeat_after === 0 && r.repeat_mode === 0, 'after<=0,mode 0 clears repeat -> {0,0}')
  ok(isRecurring(vt) === false, 'after<=0,mode 0 leaves a non-recurring vtodo')
}

// --- advance a DAILY rrule: date-shift DTSTART+DUE by exactly 1 day, reopen ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 86400, 0)
  const res = advanceRecurringVtodo(vt, now)
  ok(res.advanced === true && res.done === false, 'DAILY advance returns {advanced:true, done:false}')
  ok(iso(vt, 'dtstart') === '2026-06-09T09:00:00.000Z', 'DAILY advance moves DTSTART forward exactly 1 day')
  ok(iso(vt, 'due') === '2026-06-09T09:00:00.000Z', 'DAILY advance shifts DUE by the same delta')
  ok(vt.getFirstPropertyValue('status') === 'NEEDS-ACTION', 'DAILY advance reopens the task (NEEDS-ACTION)')
}

// --- COUNT=2: first advance consumes one, second exhausts -> COMPLETED ---
{
  const vt = makeVt()
  vt.updatePropertyWithValue('rrule', new ICAL.Recur({ freq: 'DAILY', interval: 1, count: 2 }))
  const r1 = advanceRecurringVtodo(vt, now)
  ok(r1.advanced === true && r1.done === false, 'COUNT=2 first advance succeeds (count -> 1)')
  ok(vt.getFirstPropertyValue('status') === 'NEEDS-ACTION', 'COUNT first advance reopens the task')
  const r2 = advanceRecurringVtodo(vt, now)
  ok(r2.advanced === false && r2.done === true, 'COUNT exhausted second advance returns {advanced:false, done:true}')
  ok(vt.getFirstPropertyValue('status') === 'COMPLETED', 'COUNT exhaustion marks the task COMPLETED')
}

// --- mode 2 advance: DUE jumps to now()+interval ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 3600, 2)
  const res = advanceRecurringVtodo(vt, now)
  ok(res.advanced === true && res.done === false, 'mode 2 advance returns {advanced:true, done:false}')
  ok(iso(vt, 'due') === '2026-06-08T13:00:00.000Z', 'mode 2 advance sets DUE to now()+3600s')
  // advanceFromCompletion also shifts DTSTART by the same delta (newDue-oldDue=14400s)
  // and reopens the task — lock both so the side effects can't silently regress.
  ok(iso(vt, 'dtstart') === '2026-06-08T13:00:00.000Z', 'mode 2 advance shifts DTSTART by the same delta (09:00Z -> 13:00Z)')
  ok(vt.getFirstPropertyValue('status') === 'NEEDS-ACTION', 'mode 2 advance reopens the task (NEEDS-ACTION)')
}

// --- not recurring: advance is a no-op ---
{
  const vt = makeVt() // no rrule, no x-props
  const res = advanceRecurringVtodo(vt, now)
  ok(res.advanced === false && res.done === false, 'non-recurring vtodo advance is a no-op {advanced:false, done:false}')
}

// --- absolute VALARM trigger shifts with the occurrence on a normal rrule advance ---
{
  const vt = makeVt()
  applyRepeatFields(vt, 86400, 0)
  const valarm = new ICAL.Component('valarm')
  valarm.updatePropertyWithValue('action', 'DISPLAY')
  const trig = new ICAL.Property('trigger')
  trig.setValue(t('2026-06-08T08:45:00Z')) // absolute DATE-TIME trigger
  valarm.addProperty(trig)
  vt.addSubcomponent(valarm)
  advanceRecurringVtodo(vt, now)
  const moved = vt.getAllSubcomponents('valarm')[0].getFirstProperty('trigger').getFirstValue()
  ok(moved instanceof ICAL.Time, 'absolute VALARM trigger stays a DATE-TIME after advance')
  ok(moved.toJSDate().toISOString() === '2026-06-09T08:45:00.000Z', 'absolute VALARM trigger shifts by the same 1-day delta')
}

console.log(`\nrecurrence.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
