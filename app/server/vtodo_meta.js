// Read/write helpers for the app's own VTODO metadata (cue / habit log / goal).
// Everything lives ON the VTODO so it round-trips through getModifyPut
// (read→mutate→PUT) and syncs to the user's devices. Default storage is
// X-REMINDERS-* properties — the existing repeat fields (x-reminders-repeat-*)
// already prove unknown X-props survive ical.js/tsdav and generic CalDAV servers.
//
// A DESCRIPTION-fenced fallback is supported for READS so that, if a particular
// server is ever found to strip unknown X-props, flipping STRATEGY to 'fence'
// keeps the feature working without touching call sites or the wire shape.
import ICAL from 'ical.js'

// 'xprop' (default) | 'fence'. Reads always check both; only writes branch.
const STRATEGY = 'xprop'

const FENCE_BEGIN = '-----REMINDERS-META-----'
const FENCE_END = '-----END-REMINDERS-META-----'

// Logical key -> X-property name. (RELATED-TO for goal links is handled
// separately below — it's a standard iCal property, not an X-prop.)
const XPROP = {
  cue: 'x-reminders-cue',
  cue_trigger: 'x-reminders-cue-trigger',
  habit_log: 'x-reminders-habit-log',
  is_goal: 'x-reminders-goal',
  goal_plan: 'x-reminders-goal-plan',
  flow: 'x-reminders-flow',
  dread: 'x-reminders-dread',
  time_estimate: 'x-reminders-estimate',
  // v2 organizing dimensions — a task's Project/Area membership (single id from
  // the app-owned areas registry), the explicit Eisenhower "important" axis, and
  // the Capture→Clarify inbox state. All optional X-props so legacy tasks read as
  // no-area / not-important / unclarified (sensible defaults for the spine).
  area: 'x-reminders-area',
  important: 'x-reminders-important',
  clarified: 'x-reminders-clarified',
}

// ---- low-level text accessors ----
function getXText(vt, name) {
  const v = vt.getFirstPropertyValue(name)
  return v == null ? '' : String(v)
}
function setXText(vt, name, value) {
  vt.removeAllProperties(name)
  const s = value == null ? '' : String(value)
  if (!s) return
  // Force VALUE=TEXT so ical.js escapes commas/semicolons on the wire (\, \;).
  // Without this, updatePropertyWithValue emits the value unescaped: ical.js can
  // still read it back, but RFC-compliant CalDAV servers (e.g. Radicale) treat an
  // unescaped comma in a TEXT value as a value separator and TRUNCATE it on
  // re-serialize — silently losing everything after the first comma. That breaks
  // any value that can contain commas: a cue/goal_plan with prose, and the flow
  // JSON ({"x":..,"y":..,"to":[..]}) which always has them.
  const p = new ICAL.Property(name)
  p.resetType('text')
  p.setValue(s)
  vt.addProperty(p)
}

// ---- DESCRIPTION fence (fallback storage) ----
// Split a DESCRIPTION into the user-facing text and the parsed meta object.
// The fenced block is always appended at the end (in fence mode), so the text
// is everything before the fence with trailing whitespace trimmed.
export function splitDescription(desc) {
  const raw = String(desc || '')
  const i = raw.indexOf(FENCE_BEGIN)
  if (i < 0) return { text: raw, meta: {} }
  const after = raw.slice(i + FENCE_BEGIN.length)
  const j = after.indexOf(FENCE_END)
  const inner = j < 0 ? after : after.slice(0, j)
  let meta = {}
  try { const m = JSON.parse(inner.trim()); if (m && typeof m === 'object') meta = m } catch { /* not our fence */ }
  return { text: raw.slice(0, i).replace(/\s+$/, ''), meta }
}

// User-facing description with any meta fence removed (used by the serializer so
// a fence never leaks into the task's notes).
export const cleanDescription = (vt) => splitDescription(getXText(vt, 'description')).text

function writeFenceKey(vt, key, value) {
  const { text, meta } = splitDescription(getXText(vt, 'description'))
  if (value == null || value === '') delete meta[key]
  else meta[key] = String(value)
  const next = Object.keys(meta).length
    ? (text ? text + '\n\n' : '') + FENCE_BEGIN + '\n' + JSON.stringify(meta) + '\n' + FENCE_END
    : text
  vt.removeAllProperties('description')
  if (next) vt.updatePropertyWithValue('description', next)
}

// ---- generic meta read/write ----
export function readMeta(vt, key) {
  const x = XPROP[key]
  const direct = x ? getXText(vt, x) : ''
  if (direct) return direct
  const { meta } = splitDescription(getXText(vt, 'description'))
  return meta && meta[key] != null ? String(meta[key]) : ''
}
export function writeMeta(vt, key, value) {
  if (STRATEGY === 'fence') return writeFenceKey(vt, key, value)
  const x = XPROP[key]
  if (x) setXText(vt, x, value)
}

// ---- cue (implementation intention) ----
export const readCue = (vt) => readMeta(vt, 'cue')
export const writeCue = (vt, cue) => writeMeta(vt, 'cue', String(cue || '').trim())

// ---- typed cue trigger (the machine-readable "when" of an if-then plan) ----
// Pairs with the free-text `cue`: a structured trigger so a cue can be surfaced
// and filtered by kind (e.g. the Focus widget picking time-triggered cues for
// "now"). Implementation intentions ("when X, then Y") are the best-evidenced
// productivity lever (Gollwitzer & Sheeran 2006, d≈.65). Shape stored as opaque
// JSON: { kind: 'time'|'location'|'after', value: string }. Null = no trigger.
const CUE_KINDS = new Set(['time', 'location', 'after'])
export function readCueTrigger(vt) {
  const raw = readMeta(vt, 'cue_trigger')
  if (!raw) return null
  let o
  try { o = JSON.parse(raw) } catch { return null }
  if (!o || typeof o !== 'object' || !CUE_KINDS.has(o.kind)) return null
  const value = String(o.value == null ? '' : o.value).trim()
  return value ? { kind: o.kind, value } : null
}
export function writeCueTrigger(vt, trig) {
  if (trig == null) return writeMeta(vt, 'cue_trigger', '')
  const kind = CUE_KINDS.has(trig.kind) ? trig.kind : 'after'
  const value = String(trig.value == null ? '' : trig.value).trim()
  writeMeta(vt, 'cue_trigger', value ? JSON.stringify({ kind, value }) : '')
}

// ---- dread (avoidance weight, 0..5) ----
// An optional "how much do I want to avoid this" weight. Surfaces a dreaded-but-
// important task as the day's frog so a user doesn't quietly default to easier
// work (KC & Staats 2020). Modeled after Amazing Marvin's graded "frog" strategy.
const clampDread = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0 }
export const readDread = (vt) => clampDread(readMeta(vt, 'dread'))
export const writeDread = (vt, v) => writeMeta(vt, 'dread', clampDread(v) ? String(clampDread(v)) : '')

// ---- area (Project/Area membership) ----
// A single app-owned area id (see server/areas.js). "What is this task part of?"
// Decoupled from which CalDAV calendar the VTODO physically lives in — moving a
// task between Projects/Areas is a metadata edit, not a calendar migration.
export const readArea = (vt) => readMeta(vt, 'area')
export const writeArea = (vt, id) => writeMeta(vt, 'area', String(id || '').trim())

// ---- importance (the Eisenhower "important" axis; boolean) ----
// A first-class flag, distinct from priority. The matrix's importance quadrant
// is driven by THIS, not by inferring importance from a priority threshold.
export const readImportant = (vt) => readMeta(vt, 'important') === '1'
export const writeImportant = (vt, on) => writeMeta(vt, 'important', on ? '1' : '')

// ---- clarified (Capture→Clarify inbox state; boolean) ----
// Capture creates tasks UNclarified — they sit in the Inbox until a deliberate
// Clarify pass assigns area/context/importance/date. Absent = still in the Inbox.
export const readClarified = (vt) => readMeta(vt, 'clarified') === '1'
export const writeClarified = (vt, on) => writeMeta(vt, 'clarified', on ? '1' : '')

// ---- time estimate (minutes) ----
// Optional minutes-to-complete. Enumerating/estimating work counters the planning
// fallacy (Kruger & Evans 2004) and feeds the Daily Planning roll-up so a day
// doesn't get over-committed. 0 / absent = no estimate.
const clampEstimate = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0 }
export const readEstimate = (vt) => clampEstimate(readMeta(vt, 'time_estimate'))
export const writeEstimate = (vt, v) => writeMeta(vt, 'time_estimate', clampEstimate(v) ? String(clampEstimate(v)) : '')

// ---- habit completion log ----
// A recurring task's completions are NOT otherwise recoverable: advancing a
// recurrence date-shifts the master and reopens it (no STATUS:COMPLETED, no
// RECURRENCE-ID overrides). We append the completion DAY to X-REMINDERS-HABIT-LOG
// so streak/consistency can be reconstructed from CalDAV alone. Stored as a
// space-separated list of YYYY-MM-DD, deduped, sorted, capped to the last N days.
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const HABIT_CAP = 400

export function readHabitLog(vt) {
  const raw = readMeta(vt, 'habit_log')
  if (!raw) return []
  // tolerate space- or comma-separated (forward/back compatible)
  return [...new Set(String(raw).split(/[\s,]+/).map((s) => s.trim()).filter((s) => YMD_RE.test(s)))].sort()
}
export function writeHabitLog(vt, dates, cap = HABIT_CAP) {
  const uniq = [...new Set((dates || []).map(String).filter((s) => YMD_RE.test(s)))].sort()
  writeMeta(vt, 'habit_log', uniq.slice(-cap).join(' '))
}
// Append one completion day (idempotent per day). `ymd` is 'YYYY-MM-DD'.
export function appendHabitLog(vt, ymd, cap = HABIT_CAP) {
  if (!YMD_RE.test(String(ymd))) return
  writeHabitLog(vt, [...readHabitLog(vt), String(ymd)], cap)
}

// ---- goals ----
// A goal is just a VTODO flagged X-REMINDERS-GOAL=1, with an optional WOOP-style
// plan in X-REMINDERS-GOAL-PLAN. Child tasks link UP to it via the standard
// RELATED-TO;RELTYPE=PARENT property (value = the goal's UID).
export const readGoalFlag = (vt) => readMeta(vt, 'is_goal') === '1'
export const writeGoalFlag = (vt, on) => writeMeta(vt, 'is_goal', on ? '1' : '')
export const readGoalPlan = (vt) => readMeta(vt, 'goal_plan')
export const writeGoalPlan = (vt, plan) => writeMeta(vt, 'goal_plan', String(plan || '').trim())

// RFC 5545: RELTYPE defaults to PARENT when the parameter is absent.
const relIsParent = (p) => {
  const rt = p.getParameter && p.getParameter('reltype')
  return !rt || String(rt).toUpperCase() === 'PARENT'
}
export function readParentGoal(vt) {
  for (const p of vt.getAllProperties('related-to')) {
    if (relIsParent(p)) { const v = p.getFirstValue(); if (v) return String(v) }
  }
  return ''
}
// Replace only the PARENT link; preserve any foreign RELATED-TO (SIBLING/CHILD).
export function writeParentGoal(vt, uid) {
  const keep = vt.getAllProperties('related-to').filter((p) => !relIsParent(p))
  vt.removeAllProperties('related-to')
  for (const p of keep) vt.addProperty(p)
  const u = String(uid || '').trim()
  if (!u) return
  const p = new ICAL.Property('related-to')
  p.setParameter('reltype', 'PARENT')
  p.setValue(u)
  vt.addProperty(p)
}

// ---- flow canvas (Cues mindmap) ----
// A reminder's position + outgoing links on the Cues canvas. Stored as opaque
// JSON in X-REMINDERS-FLOW; read by the Cues widget ONLY (no other widget touches
// it). Shape: { x:Number, y:Number, to:[uid,…] }. The graph is distributed —
// every node owns its own coordinates and its outgoing edges — so there is no
// global document to keep in sync. Empty/blank object means "not placed yet".
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
export function readFlow(vt) {
  const raw = readMeta(vt, 'flow')
  if (!raw) return null
  let o
  try { o = JSON.parse(raw) } catch { return null }
  if (!o || typeof o !== 'object') return null
  return {
    x: num(o.x),
    y: num(o.y),
    to: Array.isArray(o.to) ? [...new Set(o.to.map((s) => String(s || '').trim()).filter(Boolean))] : [],
  }
}
export function writeFlow(vt, flow) {
  if (flow == null) return writeMeta(vt, 'flow', '')
  const clean = {
    x: num(flow.x),
    y: num(flow.y),
    to: Array.isArray(flow.to) ? [...new Set(flow.to.map((s) => String(s || '').trim()).filter(Boolean))] : [],
  }
  writeMeta(vt, 'flow', JSON.stringify(clean))
}
