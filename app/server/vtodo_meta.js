// Read/write helpers for the app's own VTODO metadata (cue / habit log / goal).
// Everything lives ON the VTODO so it round-trips through getModifyPut
// (read→mutate→PUT) and syncs to the user's devices. Default storage is
// X-REMINDERS-* properties — the existing repeat fields (x-reminders-repeat-*)
// already prove unknown X-props survive ical.js/tsdav and generic CalDAV servers.
//
// A DESCRIPTION-fenced fallback is supported for READS so that, if a particular
// server is ever found to strip unknown X-props, flipping STRATEGY to 'fence'
// keeps the feature working without touching call sites or the wire shape.

// 'xprop' (default) | 'fence'. Reads always check both; only writes branch.
const STRATEGY = 'xprop'

const FENCE_BEGIN = '-----REMINDERS-META-----'
const FENCE_END = '-----END-REMINDERS-META-----'

// Logical key -> X-property name. (RELATED-TO for goal links is handled
// separately below — it's a standard iCal property, not an X-prop.)
const XPROP = {
  cue: 'x-reminders-cue',
  habit_log: 'x-reminders-habit-log',
  is_goal: 'x-reminders-goal',
  goal_plan: 'x-reminders-goal-plan',
}

// ---- low-level text accessors ----
function getXText(vt, name) {
  const v = vt.getFirstPropertyValue(name)
  return v == null ? '' : String(v)
}
function setXText(vt, name, value) {
  // Store verbatim like the existing x-reminders-repeat-* props: unknown X-props
  // round-trip as a single opaque value (no comma-splitting / escaping surprises).
  vt.removeAllProperties(name)
  const s = value == null ? '' : String(value)
  if (s) vt.updatePropertyWithValue(name, s)
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
