// CalDAV round-trip proof for the app's VTODO metadata layer (server/vtodo_meta.js):
// values written to a VTODO must survive vcal.toString() -> ICAL.parse and must
// not clobber foreign properties/alarms. Imports only ical.js (no SQLite).
// Run with: node test/vtodo_meta.test.mjs
import ICAL from 'ical.js'
import { readCue, writeCue, cleanDescription, splitDescription, readHabitLog, writeHabitLog, appendHabitLog } from '../server/vtodo_meta.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

function makeVtodo() {
  const vcal = new ICAL.Component('vcalendar')
  vcal.updatePropertyWithValue('version', '2.0')
  vcal.updatePropertyWithValue('prodid', '-//test//EN')
  const vt = new ICAL.Component('vtodo')
  vt.updatePropertyWithValue('uid', 'u1')
  vt.updatePropertyWithValue('summary', 'Task')
  vcal.addSubcomponent(vt)
  return { vcal, vt }
}
function roundtrip(vcal) {
  const re = new ICAL.Component(ICAL.parse(vcal.toString()))
  return re.getAllSubcomponents('vtodo')[0]
}

// ---- cue survives a full serialize -> parse, foreign props/alarms preserved ----
{
  const { vcal, vt } = makeVtodo()
  writeCue(vt, 'after morning erg')
  vt.updatePropertyWithValue('x-foo-custom', 'keepme')           // foreign X-prop
  const va = new ICAL.Component('valarm')                         // foreign VALARM (no x-reminders-app tag)
  va.updatePropertyWithValue('action', 'DISPLAY')
  va.updatePropertyWithValue('description', 'ext')
  va.updatePropertyWithValue('uid', 'foreign-1')
  vt.addSubcomponent(va)

  const vt2 = roundtrip(vcal)
  ok(readCue(vt2) === 'after morning erg', 'cue survives toString -> parse')
  ok(String(vt2.getFirstPropertyValue('x-foo-custom')) === 'keepme', 'foreign X-prop preserved')
  ok(vt2.getAllSubcomponents('valarm').length === 1, 'foreign VALARM preserved')
}

// ---- free text with commas / semicolons / unicode survives verbatim ----
{
  const { vcal, vt } = makeVtodo()
  const tricky = 'after erg, then run; pace → 4:30'
  writeCue(vt, tricky)
  ok(readCue(roundtrip(vcal)) === tricky, 'cue with comma/semicolon/arrow/colon round-trips intact')
}

// ---- writeCue trims, and "" clears the property ----
{
  const { vt } = makeVtodo()
  writeCue(vt, '   spaced cue   ')
  ok(readCue(vt) === 'spaced cue', 'writeCue trims surrounding whitespace')
  writeCue(vt, '')
  ok(readCue(vt) === '', 'writeCue("") clears the cue')
  ok(vt.getAllProperties('x-reminders-cue').length === 0, 'cleared cue removes the X-prop entirely')
}

// ---- DESCRIPTION-fence fallback (the "server stripped X-props" path) ----
{
  const desc = 'Buy groceries\n\n-----REMINDERS-META-----\n{"cue":"after work"}\n-----END-REMINDERS-META-----'
  const { text, meta } = splitDescription(desc)
  ok(text === 'Buy groceries', 'splitDescription returns the user text without the fence')
  ok(meta.cue === 'after work', 'splitDescription parses the fenced meta JSON')
}
{
  const { vt } = makeVtodo()
  vt.updatePropertyWithValue('description', 'notes\n\n-----REMINDERS-META-----\n{"cue":"fenced"}\n-----END-REMINDERS-META-----')
  ok(readCue(vt) === 'fenced', 'readCue falls back to the DESCRIPTION fence when no X-prop is set')
  ok(cleanDescription(vt) === 'notes', 'cleanDescription strips the fence for user-facing notes')
}
{
  const { vt } = makeVtodo()
  vt.updatePropertyWithValue('description', 'just notes')
  ok(cleanDescription(vt) === 'just notes', 'plain notes pass through cleanDescription untouched')
  ok(Object.keys(splitDescription('plain').meta).length === 0, 'no fence -> empty meta object')
}
{
  // X-prop takes precedence over a fence if both somehow exist
  const { vt } = makeVtodo()
  writeCue(vt, 'xprop wins')
  vt.updatePropertyWithValue('description', 'n\n\n-----REMINDERS-META-----\n{"cue":"fenced"}\n-----END-REMINDERS-META-----')
  ok(readCue(vt) === 'xprop wins', 'X-prop value takes precedence over the fence')
}

// ---- habit log: round-trips, dedupes per day, sorts, caps ----
{
  const { vcal, vt } = makeVtodo()
  appendHabitLog(vt, '2026-06-16')
  appendHabitLog(vt, '2026-06-15')
  appendHabitLog(vt, '2026-06-16') // duplicate same day -> idempotent
  const vt2 = roundtrip(vcal)
  ok(JSON.stringify(readHabitLog(vt2)) === JSON.stringify(['2026-06-15', '2026-06-16']), 'habit log dedupes per day, sorts, survives round-trip')
}
{
  const { vt } = makeVtodo()
  appendHabitLog(vt, 'not-a-date')
  ok(readHabitLog(vt).length === 0, 'append rejects non-YYYY-MM-DD input')
}
{
  // cap keeps only the most recent N days
  const { vt } = makeVtodo()
  const many = []
  for (let i = 0; i < 10; i++) many.push(`2026-01-${String(i + 1).padStart(2, '0')}`)
  writeHabitLog(vt, many, 3)
  ok(JSON.stringify(readHabitLog(vt)) === JSON.stringify(['2026-01-08', '2026-01-09', '2026-01-10']), 'writeHabitLog caps to the last N days')
}
{
  // tolerant read of a comma-separated value (forward/back compat)
  const { vt } = makeVtodo()
  vt.updatePropertyWithValue('x-reminders-habit-log', '2026-02-02,2026-02-01')
  ok(JSON.stringify(readHabitLog(vt)) === JSON.stringify(['2026-02-01', '2026-02-02']), 'readHabitLog tolerates comma separators')
}

console.log(`\nvtodo_meta.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
