// Shared VTODO helpers (server/vtodo.js): master picking among recurrence
// overrides, defensive parsing, CATEGORIES read/write round-trip. Run with:
//   node test/vtodo.test.mjs
import ICAL from 'ical.js'
import { pickMaster, safeParse, categoryNames, setCategories } from '../server/vtodo.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const wrap = (...vtodos) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vtodos.flat(), 'END:VCALENDAR'].join('\r\n')
const todo = (lines) => ['BEGIN:VTODO', 'UID:u1', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VTODO']

// ---- safeParse + pickMaster ----
{
  const { vcal, vt } = safeParse(wrap(todo(['SUMMARY:plain'])))
  ok(vcal && vt && vt.getFirstPropertyValue('summary') === 'plain', 'parses a single plain VTODO')
}
{
  // A recurring task with a per-occurrence override: the master has no RECURRENCE-ID.
  const ics = wrap(
    todo(['SUMMARY:override', 'RECURRENCE-ID:20260102T000000Z']),
    todo(['SUMMARY:master', 'RRULE:FREQ=DAILY']),
  )
  const { vt } = safeParse(ics)
  ok(vt.getFirstPropertyValue('summary') === 'master', 'pickMaster skips RECURRENCE-ID overrides')
}
{
  const onlyOverride = wrap(todo(['SUMMARY:solo', 'RECURRENCE-ID:20260102T000000Z']))
  ok(safeParse(onlyOverride).vt.getFirstPropertyValue('summary') === 'solo', 'falls back to the first VTODO when all carry RECURRENCE-ID')
  ok(pickMaster(new ICAL.Component('vcalendar')) === null, 'no VTODO at all -> null')
}
{
  const r = safeParse('this is not ics')
  ok(r.vcal === null && r.vt === null, 'garbage input never throws')
}

// ---- categoryNames ----
{
  const { vt } = safeParse(wrap(todo(['CATEGORIES:Work,Home', 'CATEGORIES: Work , Errands '])))
  ok(categoryNames(vt).sort().join() === 'Errands,Home,Work', 'merges multiple CATEGORIES props, trims, de-dupes')
}
{
  const { vt } = safeParse(wrap(todo(['SUMMARY:none'])))
  ok(categoryNames(vt).length === 0, 'no CATEGORIES -> empty list')
}

// ---- setCategories round-trip ----
{
  const { vcal, vt } = safeParse(wrap(todo(['CATEGORIES:Old'])))
  setCategories(vt, ['A', 'B'])
  const back = safeParse(vcal.toString()).vt
  ok(categoryNames(back).join() === 'A,B', 'setCategories replaces and survives serialize/parse')
  setCategories(vt, [])
  ok(categoryNames(safeParse(vcal.toString()).vt).length === 0, 'setCategories([]) clears every CATEGORIES property')
}

console.log(`\nvtodo.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
