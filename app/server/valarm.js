// VALARM read/write helpers. Reminders set in the app become VALARMs on the
// VTODO, which sync to the user's devices (DAVx5 / Tasks.org / Apple) as real
// notifications. (The polling/firing side lives in valarm-poller.js — P1b.)
import crypto from 'node:crypto'
import ICAL from 'ical.js'

const XAPP = 'x-reminders-app' // tags the alarms WE manage so we never clobber foreign ones

// Replace our VALARMs with absolute-time DISPLAY alarms; foreign alarms untouched.
// remindersISO: [{reminder:ISO}] or [ISO].
export function applyReminders(vt, remindersISO) {
  for (const va of vt.getAllSubcomponents('valarm').filter((a) => String(a.getFirstPropertyValue(XAPP) || '') === '1')) {
    vt.removeSubcomponent(va)
  }
  if (!Array.isArray(remindersISO)) return
  const summary = String(vt.getFirstPropertyValue('summary') || 'Reminder')
  for (const r of remindersISO) {
    const iso = r && typeof r === 'object' ? r.reminder : r
    const d = new Date(iso)
    if (isNaN(d)) continue
    const va = new ICAL.Component('valarm')
    va.updatePropertyWithValue('action', 'DISPLAY')
    va.updatePropertyWithValue('description', summary)
    const trig = new ICAL.Property('trigger')
    trig.resetType('date-time')
    trig.setValue(ICAL.Time.fromJSDate(d, true)) // absolute UTC
    va.addProperty(trig)
    va.updatePropertyWithValue('uid', 'rmd-' + crypto.randomUUID())
    va.updatePropertyWithValue(XAPP, '1')
    vt.addSubcomponent(va)
  }
}

// VALARM -> [{reminder:ISO}] (absolute triggers as-is; relative resolved against
// DUE for RELATED=END, else DTSTART). Used by the wire serializer.
export function readReminders(vt) {
  const dtstart = vt.getFirstPropertyValue('dtstart')
  const due = vt.getFirstPropertyValue('due')
  const out = []
  for (const va of vt.getAllSubcomponents('valarm')) {
    const trig = va.getFirstProperty('trigger')
    const v = trig && trig.getFirstValue()
    let when = null
    if (v instanceof ICAL.Time) {
      when = v.toJSDate()
    } else if (v instanceof ICAL.Duration) {
      const related = String((trig.getParameter && trig.getParameter('related')) || 'START').toUpperCase()
      const anchor = related === 'END' ? (due || dtstart) : (dtstart || due)
      if (anchor && typeof anchor.clone === 'function') { const t = anchor.clone(); t.addDuration(v); when = t.toJSDate() }
    }
    if (when && !isNaN(when)) out.push(when.toISOString())
  }
  return [...new Set(out)].sort().map((reminder) => ({ reminder }))
}
