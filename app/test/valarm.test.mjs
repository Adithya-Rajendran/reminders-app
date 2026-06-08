// Characterization tests for server/valarm.js — the VTODO <-> VALARM reminder
// bridge. Locks: applyReminders writes one absolute DISPLAY alarm per reminder
// tagged x-reminders-app (uid 'rmd-…'), never touches foreign VALARMs, skips bad
// dates, and takes {reminder} objects or bare ISO strings; readReminders reads
// ALL alarms (absolute as-is, relative DURATION triggers resolved vs DUE/DTSTART),
// deduped and sorted ascending. Run with:
//   docker run --rm -v /home/ubuntu/claude/reminders-app/app:/app -w /app \
//     -e CONFIG_STORE=sqlite -e CONFIG_DB_PATH=/tmp/valarm.test.db node:22 \
//     node test/valarm.test.mjs
import ICAL from 'ical.js'
import { applyReminders, readReminders } from '../server/valarm.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const mkVtodo = (summary) => {
  const vt = new ICAL.Component('vtodo')
  vt.updatePropertyWithValue('summary', summary)
  return vt
}
const utc = (iso) => ICAL.Time.fromJSDate(new Date(iso), true)
// A "foreign" VALARM: DISPLAY + absolute date-time trigger, NO x-reminders-app tag.
const foreignAlarm = (iso) => {
  const va = new ICAL.Component('valarm')
  va.updatePropertyWithValue('action', 'DISPLAY')
  const trig = new ICAL.Property('trigger')
  trig.resetType('date-time')
  trig.setValue(utc(iso))
  va.addProperty(trig)
  return va
}
const allAlarms = (vt) => vt.getAllSubcomponents('valarm')
const isOurs = (a) => String(a.getFirstPropertyValue('x-reminders-app') || '') === '1'
const ours = (vt) => allAlarms(vt).filter(isOurs)
const trigInstant = (va) => va.getFirstProperty('trigger').getFirstValue().toJSDate().getTime()

const A = '2026-06-08T09:00:00Z'
const F = '2026-06-01T00:00:00Z'
const R1 = '2026-06-08T10:00:00Z'
const R2 = '2026-06-09T10:00:00Z'
const R3 = '2026-06-10T10:00:00Z'

// 1) One reminder -> one tagged, absolute DISPLAY alarm carrying the summary.
{
  const vt = mkVtodo('Buy milk')
  applyReminders(vt, [{ reminder: A }])
  const mine = ours(vt)
  ok(mine.length === 1, '1: one reminder -> one tagged alarm')
  const va = mine[0]
  ok(va.getFirstPropertyValue('action') === 'DISPLAY', '1: alarm action is DISPLAY')
  ok(va.getFirstPropertyValue('description') === 'Buy milk', '1: description is the vtodo summary')
  ok(String(va.getFirstPropertyValue('x-reminders-app')) === '1', '1: alarm tagged x-reminders-app=1')
  ok(String(va.getFirstPropertyValue('uid') || '').startsWith('rmd-'), '1: uid starts with rmd-')
  ok(va.getFirstProperty('trigger').getFirstValue() instanceof ICAL.Time, '1: trigger is an absolute date-time')
  ok(trigInstant(va) === Date.parse(A), '1: trigger instant equals the reminder instant')
}

// 2 & 3) Foreign alarms survive repeated apply; null drops only ours.
{
  const vt = mkVtodo('Has foreign alarm')
  vt.addSubcomponent(foreignAlarm(F))
  ok(allAlarms(vt).length === 1, '2: starts with one foreign alarm')

  applyReminders(vt, [{ reminder: R1 }])
  ok(allAlarms(vt).length === 2 && ours(vt).length === 1, '2: apply adds ours, keeps foreign (2 total)')

  applyReminders(vt, [R2, R3]) // bare ISO strings, second apply
  ok(ours(vt).length === 2, '2: re-apply replaces our prior alarms (now 2 ours)')
  ok(allAlarms(vt).length === 3, '2: foreign survived re-apply (3 total)')
  const foreignStill = allAlarms(vt).filter((a) => !isOurs(a))
  ok(foreignStill.length === 1 && trigInstant(foreignStill[0]) === Date.parse(F), '2: surviving alarm is the untouched foreign one')

  applyReminders(vt, null) // non-array: drop ours, add none
  ok(ours(vt).length === 0, '3: applyReminders(vt,null) removes all of ours')
  ok(allAlarms(vt).length === 1 && trigInstant(allAlarms(vt)[0]) === Date.parse(F), '3: foreign alarm still present after null')
}

// 4) Invalid date strings are skipped; the valid one still applies.
{
  const vt = mkVtodo('Mixed')
  applyReminders(vt, [{ reminder: 'not-a-date' }, { reminder: A }])
  ok(ours(vt).length === 1, '4: invalid date skipped, exactly one of ours applied')
  ok(trigInstant(ours(vt)[0]) === Date.parse(A), '4: the surviving alarm is the valid date')
}

// 5) Bare ISO strings (not wrapped in {reminder}) are accepted too.
{
  const vt = mkVtodo('Bare')
  applyReminders(vt, [A])
  ok(ours(vt).length === 1 && trigInstant(ours(vt)[0]) === Date.parse(A), '5: bare ISO string applied as a reminder')
}

// 6) readReminders reads ALL alarms (incl foreign), deduped and sorted ascending.
{
  const vt = mkVtodo('Read all')
  vt.addSubcomponent(foreignAlarm(R2)) // foreign at the MIDDLE instant
  applyReminders(vt, [R3, R1, R2]) // R2 duplicates the foreign instant; out of order
  const got = readReminders(vt)
  ok(got.length === 3, '6: foreign+ours read together, duplicate instant deduped to one')
  const order = got.map((g) => Date.parse(g.reminder))
  ok(order[0] === Date.parse(R1) && order[1] === Date.parse(R2) && order[2] === Date.parse(R3), '6: results sorted ascending')
}

// Helper: attach a relative -15min DURATION trigger (optionally RELATED) to a vtodo.
const addRelTrigger = (vt, related) => {
  const va = new ICAL.Component('valarm')
  va.updatePropertyWithValue('action', 'DISPLAY')
  const trig = new ICAL.Property('trigger')
  trig.setValue(ICAL.Duration.fromSeconds(-900)) // -15 min
  if (related) trig.setParameter('related', related)
  va.addProperty(trig)
  vt.addSubcomponent(va)
}

// 7a) RELATED=END anchors on DUE — even when a (different) DTSTART is also present,
// proving the END branch is honored rather than always falling through to DTSTART.
{
  const vt = mkVtodo('Due relative')
  const dueISO = '2026-06-12T15:00:00Z'
  const decoyStartISO = '2026-06-10T03:00:00Z' // a DIFFERENT dtstart that must be ignored for END
  vt.updatePropertyWithValue('dtstart', utc(decoyStartISO))
  vt.updatePropertyWithValue('due', utc(dueISO))
  addRelTrigger(vt, 'END')
  const got = readReminders(vt)
  ok(got.length === 1, '7: relative trigger yields one resolved reminder')
  ok(Date.parse(got[0].reminder) === Date.parse(dueISO) - 900000, '7: RELATED=END resolves to DUE minus 15 min')
  ok(Date.parse(got[0].reminder) !== Date.parse(decoyStartISO) - 900000, '7: RELATED=END ignores DTSTART when DUE present')
}

// 7b) Default-RELATED (== START) anchors on DTSTART — even when a (different) DUE is
// also present, proving the START branch is honored rather than picking DUE.
{
  const vt = mkVtodo('Start relative')
  const startISO = '2026-06-12T08:00:00Z'
  const decoyDueISO = '2026-06-14T20:00:00Z' // a DIFFERENT due that must be ignored for START
  vt.updatePropertyWithValue('dtstart', utc(startISO))
  vt.updatePropertyWithValue('due', utc(decoyDueISO))
  addRelTrigger(vt, null) // no RELATED param -> defaults to START
  const got = readReminders(vt)
  ok(got.length === 1 && Date.parse(got[0].reminder) === Date.parse(startISO) - 900000, '7: default-RELATED resolves to DTSTART minus 15 min')
  ok(Date.parse(got[0].reminder) !== Date.parse(decoyDueISO) - 900000, '7: default-RELATED ignores DUE when DTSTART present')
}

// 7c) RELATED=END with no DUE falls back to DTSTART.
{
  const vt = mkVtodo('End fallback')
  const startISO = '2026-06-13T09:00:00Z'
  vt.updatePropertyWithValue('dtstart', utc(startISO)) // no DUE on the vtodo
  addRelTrigger(vt, 'END')
  const got = readReminders(vt)
  ok(got.length === 1 && Date.parse(got[0].reminder) === Date.parse(startISO) - 900000, '7: RELATED=END with no DUE falls back to DTSTART')
}

// 7d) Default-RELATED (START) with no DTSTART falls back to DUE.
{
  const vt = mkVtodo('Start fallback')
  const dueISO = '2026-06-14T11:00:00Z'
  vt.updatePropertyWithValue('due', utc(dueISO)) // no DTSTART on the vtodo
  addRelTrigger(vt, null)
  const got = readReminders(vt)
  ok(got.length === 1 && Date.parse(got[0].reminder) === Date.parse(dueISO) - 900000, '7: default-RELATED with no DTSTART falls back to DUE')
}

// 8) Round-trip on a foreign-free vtodo: apply([b,a]) then read -> exactly {a,b} sorted.
{
  const vt = mkVtodo('Round trip')
  const a = '2026-06-20T07:30:00Z'
  const b = '2026-06-21T07:30:00Z'
  applyReminders(vt, [{ reminder: b }, { reminder: a }]) // intentionally out of order
  const got = readReminders(vt)
  ok(got.length === 2, '8: round-trip yields exactly two reminders')
  ok(Date.parse(got[0].reminder) === Date.parse(a) && Date.parse(got[1].reminder) === Date.parse(b), '8: round-trip preserves both instants, sorted ascending')
}

console.log(`\nvalarm.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
