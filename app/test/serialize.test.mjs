// Characterization test for the CalDAV wire serializer + sorter in
// server/tasks_caldav.js: locks serializeVtodo(vt,listId,objectUrl) field
// mapping (id/title/done/due/priority/labels/reminders/repeat) and
// sortTasks(tasks,sortBy,desc) ordering (incl. the ZERO-date-sorts-last rule).
// Importing the module transitively opens SQLite via config.js, so point
// CONFIG_DB_PATH at a throwaway file. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite -e CONFIG_DB_PATH=/tmp/serialize.test.db node:22 node test/serialize.test.mjs
import { rmSync } from 'node:fs'
process.env.CONFIG_STORE = 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/serialize.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true }); rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true }); rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

import ICAL from 'ical.js'
import { encodeTaskId, encodeLabelId, decodeTaskId } from '../server/taskid.js'
const { serializeVtodo, sortTasks } = await import('../server/tasks_caldav.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const ZERO = '0001-01-01T00:00:00Z'
const iso = (s) => new Date(s).toISOString()
const OUR_TO_ICAL = { 1: 9, 2: 7, 3: 5, 4: 3, 5: 1 }

const LIST_ID = 7
const OBJ_URL = 'https://nc.example/cal/tasks/abc-123.ics'

function vtodo() { return new ICAL.Component('vtodo') }
function setDateProp(vt, name, jsDate) {
  const p = new ICAL.Property(name)
  p.resetType('date-time')
  p.setValue(ICAL.Time.fromJSDate(jsDate, true))
  vt.addProperty(p)
}
function addAbsoluteAlarm(vt, jsDate) {
  const va = new ICAL.Component('valarm')
  va.updatePropertyWithValue('action', 'DISPLAY')
  va.updatePropertyWithValue('description', 'ping')
  const trig = new ICAL.Property('trigger')
  trig.resetType('date-time')
  trig.setValue(ICAL.Time.fromJSDate(jsDate, true))
  va.addProperty(trig)
  vt.addSubcomponent(va)
}

// ---- identity / project mapping ----
{
  const vt = vtodo(); vt.updatePropertyWithValue('summary', 'Buy milk')
  const out = serializeVtodo(vt, LIST_ID, OBJ_URL)
  ok(out.id === encodeTaskId(LIST_ID, OBJ_URL), 'id === encodeTaskId(listId, objectUrl)')
  // Independent of encodeTaskId: the id must actually round-trip back to the
  // exact {listId, objectUrl} pair (not merely equal whatever encodeTaskId emits).
  const dec = decodeTaskId(out.id)
  ok(dec.listId === LIST_ID && dec.objectUrl === OBJ_URL, 'id decodes back to {listId, objectUrl}')
  ok(out.project_id === LIST_ID, 'project_id === listId')
  ok(out.title === 'Buy milk', 'title comes from SUMMARY')
}

// ---- untitled fallback ----
{
  const out = serializeVtodo(vtodo(), LIST_ID, OBJ_URL)
  ok(out.title === '(untitled)', 'no SUMMARY → title is (untitled)')
}

// ---- done / done_at ----
{
  const vt = vtodo(); vt.updatePropertyWithValue('summary', 'open'); vt.updatePropertyWithValue('status', 'NEEDS-ACTION')
  const out = serializeVtodo(vt, LIST_ID, OBJ_URL)
  ok(out.done === false, 'NEEDS-ACTION → done false')
  ok(out.done_at === ZERO, 'NEEDS-ACTION → done_at is the ZERO sentinel')
}
{
  const vt = vtodo(); vt.updatePropertyWithValue('summary', 'closed'); vt.updatePropertyWithValue('status', 'COMPLETED')
  setDateProp(vt, 'completed', new Date('2026-06-01T08:00:00Z'))
  const out = serializeVtodo(vt, LIST_ID, OBJ_URL)
  ok(out.done === true, 'COMPLETED → done true')
  ok(out.done_at === iso('2026-06-01T08:00:00Z'), 'COMPLETED with COMPLETED time → done_at equals that instant')
}

// ---- due_date: due, dtstart fallback, neither ----
{
  const vt = vtodo(); setDateProp(vt, 'due', new Date('2026-06-10T09:00:00Z'))
  ok(serializeVtodo(vt, LIST_ID, OBJ_URL).due_date === iso('2026-06-10T09:00:00Z'), 'due_date from DUE')
}
{
  const vt = vtodo(); setDateProp(vt, 'dtstart', new Date('2026-06-12T05:00:00Z'))
  ok(serializeVtodo(vt, LIST_ID, OBJ_URL).due_date === iso('2026-06-12T05:00:00Z'), 'due_date falls back to DTSTART when no DUE')
}
{
  ok(serializeVtodo(vtodo(), LIST_ID, OBJ_URL).due_date === ZERO, 'no DUE/DTSTART → due_date is the ZERO sentinel')
}

// ---- priority round-trip: vtodo priority OUR_TO_ICAL[P] serializes to P ----
for (const P of [1, 2, 3, 4, 5]) {
  const vt = vtodo(); vt.updatePropertyWithValue('priority', OUR_TO_ICAL[P])
  ok(serializeVtodo(vt, LIST_ID, OBJ_URL).priority === P, `ical priority ${OUR_TO_ICAL[P]} serializes to our priority ${P}`)
}
ok(serializeVtodo(vtodo(), LIST_ID, OBJ_URL).priority === 0, 'no PRIORITY property → priority 0')
{
  const vt = vtodo(); vt.updatePropertyWithValue('priority', 0)
  ok(serializeVtodo(vt, LIST_ID, OBJ_URL).priority === 0, 'PRIORITY value 0 → priority 0')
}

// ---- labels from CATEGORIES ----
{
  const vt = vtodo()
  const p = new ICAL.Property('categories'); p.setValues(['Work', 'Home']); vt.addProperty(p)
  const labels = serializeVtodo(vt, LIST_ID, OBJ_URL).labels
  const titles = new Set(labels.map((l) => l.title))
  ok(titles.has('Work') && titles.has('Home') && labels.length === 2, 'CATEGORIES → labels with both titles')
  ok(labels.every((l) => l.id.startsWith('cat_')), 'every label id is prefixed cat_')
  ok(labels.find((l) => l.title === 'Work').id === encodeLabelId('Work'), 'label id === encodeLabelId(title)')
  ok(labels.every((l) => l.hex_color === ''), 'CATEGORIES carry no color (hex_color empty)')
}

// ---- reminders from an absolute VALARM ----
{
  const vt = vtodo(); addAbsoluteAlarm(vt, new Date('2026-06-09T07:30:00Z'))
  const rem = serializeVtodo(vt, LIST_ID, OBJ_URL).reminders
  ok(rem.length === 1, 'one absolute VALARM → one reminder')
  ok(rem[0].reminder === iso('2026-06-09T07:30:00Z'), 'reminder carries the absolute trigger instant')
}

// ---- repeat fields reflect an applied RRULE ----
{
  const vt = vtodo(); vt.updatePropertyWithValue('rrule', new ICAL.Recur({ freq: 'DAILY', interval: 1 }))
  const out = serializeVtodo(vt, LIST_ID, OBJ_URL)
  ok(out.repeat_after === 86400, 'DAILY rrule → repeat_after 86400s')
  ok(out.repeat_mode === 0, 'DAILY rrule → repeat_mode 0')
}

// ---- sortTasks: default is due_date ASC with ZERO last ----
{
  const tasks = [
    { id: 'late', due_date: iso('2026-06-10T00:00:00Z') },
    { id: 'early', due_date: iso('2026-06-05T00:00:00Z') },
    { id: 'zero', due_date: ZERO },
  ]
  const sorted = sortTasks(tasks)
  ok(sorted === tasks, 'sortTasks mutates and returns the same array reference')
  ok(sorted.map((t) => t.id).join(',') === 'early,late,zero', 'default sort: due_date ascending, ZERO last')
  ok(sorted[sorted.length - 1].id === 'zero', 'ZERO-dated task always lands after real-dated tasks')
}

// ---- sortTasks: title is case-insensitive ascending ----
// Data chosen so a case-SENSITIVE sort (key without .toLowerCase()) would yield
// 'Banana,Cherry,apple' (uppercase < lowercase in code-point order) — different
// from the case-insensitive 'apple,Banana,Cherry'. This actually locks folding.
{
  const sorted = sortTasks([{ title: 'Banana' }, { title: 'apple' }, { title: 'Cherry' }], 'title')
  ok(sorted.map((t) => t.title).join(',') === 'apple,Banana,Cherry', 'sort by title is case-insensitive ascending (lowercase apple sorts before uppercase Banana)')
}

// ---- sortTasks: priority ascending, desc reverses ----
// ids are deliberately decorrelated from priority order (and from insertion
// order) so neither a no-op sort nor an accidental sort-by-id could pass:
// ascending-by-priority must reorder a/b/c into b,c,a.
{
  const mk = () => [{ id: 'a', priority: 3 }, { id: 'b', priority: 1 }, { id: 'c', priority: 2 }]
  ok(sortTasks(mk(), 'priority').map((t) => t.id).join(',') === 'b,c,a', 'sort by priority ascending')
  ok(sortTasks(mk(), 'priority', true).map((t) => t.id).join(',') === 'a,c,b', 'desc=true reverses the priority order')
}

console.log(`\nserialize.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
