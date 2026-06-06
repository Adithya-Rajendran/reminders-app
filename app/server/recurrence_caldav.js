// RRULE recurrence for VTODOs — pure ICS over an ICAL.Component(vtodo), no DB/HTTP.
// Model: a single evolving VTODO whose DTSTART/DUE is date-shifted to the next
// occurrence on completion (matches Tasks.org / OpenTasks / DAVx5 / Apple, and
// preserves the client contract: recurring completion returns done:false with an
// advanced due_date -> useTasks.js shows "Rescheduled ↻").
import ICAL from 'ical.js'

const MONTH_SECONDS = 2629800 // ~30.44d — MONTHLY shown as a nonzero repeat_after (badge gotcha)
const XMODE = 'x-reminders-repeat-mode'
const XAFTER = 'x-reminders-repeat-after'

export function registerTimezones(vcal) {
  if (!vcal) return
  try {
    for (const tzc of vcal.getAllSubcomponents('vtimezone')) {
      const tzid = tzc.getFirstPropertyValue('tzid')
      if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tzc)
    }
  } catch { /* best effort; missing TZ just risks DST drift */ }
}

export const hasCustomFromCompletion = (vt) => String(vt.getFirstPropertyValue(XMODE) || '') === '2'
export const isRecurring = (vt) => !!vt.getFirstProperty('rrule') || hasCustomFromCompletion(vt)

// RRULE anchors on DTSTART per RFC; fall back to DUE for VTODOs that only carry DUE.
const rruleAnchor = (vt) => vt.getFirstProperty('dtstart') || vt.getFirstProperty('due')

function nextAfter(recur, anchorTime) {
  const it = recur.iterator(anchorTime)
  let occ = it.next()
  while (occ && occ.compare(anchorTime) <= 0) occ = it.next()
  return occ || null
}

function bumpRevision(vt) {
  vt.updatePropertyWithValue('last-modified', ICAL.Time.now())
  vt.updatePropertyWithValue('dtstamp', ICAL.Time.now())
  vt.updatePropertyWithValue('sequence', Number(vt.getFirstPropertyValue('sequence') || 0) + 1)
}
function markCompleted(vt, now) {
  vt.updatePropertyWithValue('status', 'COMPLETED')
  vt.updatePropertyWithValue('percent-complete', 100)
  vt.updatePropertyWithValue('completed', now)
  bumpRevision(vt)
}
function markOpen(vt) {
  vt.updatePropertyWithValue('status', 'NEEDS-ACTION')
  vt.updatePropertyWithValue('percent-complete', 0)
  vt.removeAllProperties('completed')
  bumpRevision(vt)
}
function shiftBy(prop, durSeconds) {
  if (!prop) return
  const t = prop.getFirstValue()
  if (!t || typeof t.clone !== 'function') return
  const nt = t.clone(); nt.addDuration(ICAL.Duration.fromSeconds(durSeconds)); prop.setValue(nt)
}
function shiftAbsoluteAlarms(vt, durSeconds) {
  for (const va of vt.getAllSubcomponents('valarm')) {
    const trig = va.getFirstProperty('trigger')
    const v = trig && trig.getFirstValue()
    if (v instanceof ICAL.Time) { const nt = v.clone(); nt.addDuration(ICAL.Duration.fromSeconds(durSeconds)); trig.setValue(nt) }
    // relative DURATION triggers auto-shift with the moved anchor — leave them.
  }
}
function ensureAnchor(vt) {
  if (vt.getFirstProperty('dtstart')) return
  vt.updatePropertyWithValue('dtstart', vt.getFirstPropertyValue('due') || ICAL.Time.now())
}
function secondsToFreq(sec) {
  for (const [freq, s] of [['WEEKLY', 604800], ['DAILY', 86400], ['HOURLY', 3600], ['MINUTELY', 60]]) {
    if (sec % s === 0) return { freq, interval: sec / s }
  }
  return { freq: 'SECONDLY', interval: sec }
}

// Mutates vt. Returns {advanced, done}. Call only on a done:false->true transition.
export function advanceRecurringVtodo(vt, now = ICAL.Time.now()) {
  if (hasCustomFromCompletion(vt)) return advanceFromCompletion(vt, now)
  const rrProp = vt.getFirstProperty('rrule')
  if (!rrProp) return { advanced: false, done: false }
  const anchorProp = rruleAnchor(vt)
  if (!anchorProp) return { advanced: false, done: false } // no anchor → can't advance
  const anchor = anchorProp.getFirstValue()
  const recur = rrProp.getFirstValue()
  const next = nextAfter(recur, anchor)
  if (!next) { markCompleted(vt, now); return { advanced: false, done: true } } // COUNT/UNTIL exhausted
  const deltaSec = next.subtractDate(anchor).toSeconds()
  const dtstart = vt.getFirstProperty('dtstart')
  const due = vt.getFirstProperty('due')
  anchorProp.setValue(next)
  if (dtstart && due) shiftBy(anchorProp === dtstart ? due : dtstart, deltaSec)
  shiftAbsoluteAlarms(vt, deltaSec)
  if (typeof recur.isByCount === 'function' && recur.isByCount()) { recur.count = recur.count - 1; rrProp.setValue(recur) }
  markOpen(vt)
  return { advanced: true, done: false }
}

// mode 2 — no RRULE; advance DUE to now()+interval (server-side only).
function advanceFromCompletion(vt, now) {
  const interval = Math.max(0, Math.trunc(Number(vt.getFirstPropertyValue(XAFTER) || 0)))
  const dueProp = vt.getFirstProperty('due')
  const oldDue = dueProp ? dueProp.getFirstValue() : null
  const newDue = now.clone(); newDue.addDuration(ICAL.Duration.fromSeconds(interval))
  const deltaSec = oldDue ? newDue.subtractDate(oldDue).toSeconds() : interval
  if (dueProp) dueProp.setValue(newDue); else vt.updatePropertyWithValue('due', newDue)
  shiftBy(vt.getFirstProperty('dtstart'), deltaSec)
  shiftAbsoluteAlarms(vt, deltaSec)
  markOpen(vt)
  return { advanced: true, done: false }
}

// Write repeat fields onto a VTODO (clears prior RRULE/X-props first).
export function applyRepeatFields(vt, repeatAfterSec, repeatMode) {
  vt.removeAllProperties('rrule'); vt.removeAllProperties(XMODE); vt.removeAllProperties(XAFTER)
  const after = Math.max(0, Math.trunc(Number(repeatAfterSec) || 0))
  const mode = [0, 1, 2].includes(Number(repeatMode)) ? Number(repeatMode) : 0
  if (mode === 2) { if (after <= 0) return; vt.updatePropertyWithValue(XMODE, '2'); vt.updatePropertyWithValue(XAFTER, after); ensureAnchor(vt); return }
  if (mode === 1) { vt.updatePropertyWithValue('rrule', new ICAL.Recur({ freq: 'MONTHLY', interval: 1 })); ensureAnchor(vt); return }
  if (after <= 0) return
  const { freq, interval } = secondsToFreq(after)
  vt.updatePropertyWithValue('rrule', new ICAL.Recur({ freq, interval }))
  ensureAnchor(vt)
}

// Read repeat fields for the wire (display-only; RRULE is source of truth).
export function repeatFieldsFromVtodo(vt) {
  if (hasCustomFromCompletion(vt)) return { repeat_after: Math.max(0, Number(vt.getFirstPropertyValue(XAFTER) || 0)), repeat_mode: 2 }
  const rrProp = vt.getFirstProperty('rrule')
  if (!rrProp) return { repeat_after: 0, repeat_mode: 0 }
  const recur = rrProp.getFirstValue()
  const interval = recur.interval || 1
  if (recur.freq === 'MONTHLY' || recur.freq === 'YEARLY') {
    return { repeat_after: (recur.freq === 'YEARLY' ? 12 : 1) * interval * MONTH_SECONDS, repeat_mode: 1 }
  }
  const unit = { SECONDLY: 1, MINUTELY: 60, HOURLY: 3600, DAILY: 86400, WEEKLY: 604800 }[recur.freq] || 86400
  return { repeat_after: unit * interval, repeat_mode: 0 }
}
