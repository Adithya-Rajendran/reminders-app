// Alias keywords per widget TYPE, so the omnibox resolves a surface by the word a
// user actually types — including the OLD name of a renamed surface. This is the
// fix for the #1 palette friction: after "Triage" became "Prioritize", searching
// "triage" dead-ended; now it (and "eisenhower", "matrix", …) find the surface.
// Keep the type keys identical to widgets/manifest.js `type` (the stable id). Extra
// synonyms are cheap — an alias only ever RANKS a nav row, it never mislabels it.
export const SURFACE_ALIASES = Object.freeze({
  triage: ['triage', 'prioritize', 'priorities', 'eisenhower', 'matrix', 'important', 'urgent', 'focus matrix'],
  overview: ['overview', 'home', 'dashboard', 'summary', 'today', 'at a glance'],
  inbox: ['inbox', 'clarify', 'process', 'unsorted', 'captures'],
  reminders: ['reminders', 'tasks', 'todo', 'to-do', 'list', 'checklist'],
  upcoming: ['upcoming', 'agenda', 'due', 'schedule', 'deadlines'],
  calendar: ['calendar', 'events', 'month', 'week', 'agenda'],
  notes: ['notes', 'markdown', 'docs', 'wiki', 'zettel'],
  review: ['review', 'weekly review', 'stats', 'trends', 'retrospective', 'retro'],
  cues: ['cues', 'flow', 'if-then', 'triggers', 'implementation intention'],
  daily: ['daily', 'daily plan', 'today', 'plan', 'shutdown', 'mit'],
  focus: ['focus', 'pomodoro', 'timer', 'deep work', 'one thing'],
})

// The alias keywords for a widget type (empty array for an unknown type), used to
// build a nav entry's fuzzy-match keys. Total (never throws) so a future widget
// type with no alias entry simply matches on its label alone.
export function aliasesForType(type) {
  return SURFACE_ALIASES[type] || []
}
