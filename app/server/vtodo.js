// Shared VTODO parsing helpers — the bits both the task store (tasks_caldav.js)
// and the group mover (reminder_groups.js) need to agree on.
import ICAL from 'ical.js'

// The master VTODO of a parsed object: recurring tasks store per-occurrence
// override subcomponents keyed by RECURRENCE-ID; the one without it is the task.
export const pickMaster = (vcal) => { const v = vcal.getAllSubcomponents('vtodo'); return v.find((x) => !x.getFirstProperty('recurrence-id')) || v[0] || null }

// Parse raw ICS defensively (foreign servers produce odd data) — never throws.
export function safeParse(ics) {
  try { const vcal = new ICAL.Component(ICAL.parse(ics)); return { vcal, vt: pickMaster(vcal) } } catch { return { vcal: null, vt: null } }
}

// CATEGORIES (our labels/groups) as de-duplicated, trimmed names. Multiple
// CATEGORIES properties and multi-valued ones both occur in the wild.
export function categoryNames(vt) {
  const set = new Set()
  for (const p of vt.getAllProperties('categories')) for (const v of (p.getValues() || [])) { const s = String(v).trim(); if (s) set.add(s) }
  return [...set]
}

export function setCategories(vt, names) {
  vt.removeAllProperties('categories')
  if (names.length) { const p = new ICAL.Property('categories'); p.setValues(names); vt.addProperty(p) }
}
