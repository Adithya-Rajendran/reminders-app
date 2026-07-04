// Pure ranking for the unified command palette / omnibox. The palette flattens its
// sources — commands, navigation, live tasks, notes, Areas/Projects and Contexts —
// into ONE list of typed ENTRIES and ranks them together, so plain typing fuzzy-finds
// anything with no mandatory mode prefix (the old `>` is now an optional command
// filter). Kept free of React/DOM (and of the entries' side-effecting `run`/`icon`
// fields) so the framework-free node tests exercise it (test/omnibox.test.mjs).
//
// Entry shape — only the fields THIS module reads:
//   { kind, title, keys?, priority? }
//   kind      'command' | 'nav' | 'task' | 'note' | 'area' | 'context'
//             (extensible; a kind with no KIND_WEIGHT entry → weight 0)
//   title     the display string, and the default match key + highlight target
//   keys      optional array of match strings; keys[0] is the title. An ALIAS
//             (index > 0) can rank a row — e.g. the query "triage" finding the
//             renamed "Prioritize" surface — WITHOUT painting highlight positions
//             onto the unrelated title.
//   priority  optional command nudge (higher = earlier), the same field App sets.
import { fuzzyMatch } from './fuzzy.js'
import { WIDGET_MANIFEST } from '../widgets/manifest.js'
import { aliasesForType } from './palettecmds.js'

// Cross-type base weight: a precise command/navigation match should lead over a
// weak content match on a short query, while a strong content match (a task/note
// whose title the user actually typed) still wins on its own score. Deliberately
// small so the fuzzy score dominates once the query is specific.
export const KIND_WEIGHT = Object.freeze({
  command: 1.4, nav: 1.2, area: 1.1, context: 1.0, note: 0.5, task: 0.4,
})

// Rank typed entries against a query. Returns [{ item, score, positions, viaAlias }]
// best-first, dropping non-matches. A BLANK query returns [] — the palette owns the
// empty state (a curated "start here" list); we deliberately do NOT dump every entry
// ordered by weight, which is what fuzzyMatch('') would otherwise produce.
export function rankEntries(term, entries) {
  const q = String(term == null ? '' : term).trim()
  if (!q) return []
  const out = []
  for (const e of (entries || [])) {
    if (!e) continue
    const keys = (e.keys && e.keys.length) ? e.keys : [e.title]
    let best = null
    let titleM = null // the title's own match (keys[0]) — drives highlighting
    for (let i = 0; i < keys.length; i++) {
      const m = fuzzyMatch(q, String(keys[i] == null ? '' : keys[i]))
      if (i === 0) titleM = m
      if (m && (best === null || m.score > best.score)) best = m
    }
    if (!best) continue
    const weight = (KIND_WEIGHT[e.kind] || 0) + (Number(e.priority) || 0) * 0.4
    out.push({
      item: e,
      // Ranking uses the BEST key (title or alias); highlighting uses the TITLE's own
      // match, so an alias-driven hit (e.g. "triage" → "Prioritize") ranks the row but
      // never smears <b> runs across a title it didn't visibly match. A title that
      // *also* matches keeps its highlight even when an alias scored higher.
      score: best.score + weight,
      positions: titleM ? titleM.positions : [],
      viaAlias: !titleM,
    })
  }
  out.sort((a, b) =>
    (b.score - a.score)
    || (String(a.item.title).length - String(b.item.title).length)
    || String(a.item.title).localeCompare(String(b.item.title)),
  )
  return out
}

// Flatten every palette source into ONE typed, rankable entry list — the shape
// rankEntries() consumes. Kept pure (no React/DOM) so the framework-free node tests
// exercise the wiring: which sources, in what order, with which id/tag/keys, the
// Go-to-vs-Add nav verb, and the conditional Clear-filter row. The side-effecting bits
// (`icon` components + the run actions) are INJECTED via `actions`, so this module
// stays free of React and of the app's buses. WIDGET_MANIFEST + aliasesForType are
// pure data and imported directly; `dueChip` (which drags in the api client) is
// injected. `sources.filter` is the CURRENT organizer filter (drives the Clear row).
export function buildEntries(sources, actions) {
  const { commands = [], board = [], tasks = [], notes = [], areas = [], contexts = [], filter = null } = sources || {}
  const {
    newNoteIcon, clearFilterIcon, dueChip,
    onNewNote, onGoTo, onAdd, onScope, onRevealTask, onOpenNote,
  } = actions || {}
  const out = []

  // Commands (host-provided app actions + a built-in "New note").
  out.push({ kind: 'command', id: 'new-note', title: 'New note', subtitle: 'Create a note in Notes — shortcut: n', icon: newNoteIcon, priority: 1, tag: 'Command', run: onNewNote })
  for (const c of commands) {
    out.push({
      kind: 'command', id: c.id, title: c.label, subtitle: c.hint, icon: c.icon,
      priority: c.priority || 0, tag: c.tag || 'Command',
      keys: [c.label, ...(c.aliases || [])], run: c.run,
    })
  }

  // Navigation: one entry per widget surface. Present → go to it; absent → add it.
  const onBoardByType = new Map()
  for (const w of board) { if (!onBoardByType.has(w.type)) onBoardByType.set(w.type, w) }
  for (const m of WIDGET_MANIFEST) {
    const here = onBoardByType.get(m.type)
    const verb = here ? 'Go to' : 'Add'
    out.push({
      kind: 'nav', id: 'nav-' + m.type, title: `${verb} ${m.label}`,
      subtitle: here ? 'On this board' : (m.desc || 'Add to this board'), tag: verb, priority: 2,
      keys: [`${verb} ${m.label}`, m.label, ...aliasesForType(m.type)],
      run: here ? () => onGoTo(here) : () => onAdd(m.type),
    })
  }

  // Areas/Projects and Contexts — selecting one SCOPES the whole board to it (the
  // board filter bar then shows the active scope + a Clear). Not a dead-end: the
  // task-list widgets (Overview, Reminders, Upcoming, Prioritize, Review) all honour
  // the filter; the Inbox is the deliberate exception — it clarifies every capture
  // regardless of scope, since captures have no Area/Context until you clarify them.
  for (const a of areas) {
    const kind = a.kind === 'project' ? 'Project' : 'Area'
    out.push({ kind: 'area', id: a.id, title: a.name, subtitle: `Scope the board to this ${kind.toLowerCase()}`, tag: kind, keys: [a.name], run: () => onScope({ areaId: a.id, context: null }) })
  }
  for (const c of contexts) {
    out.push({ kind: 'context', id: 'ctx-' + c, title: '@' + c, subtitle: 'Scope the board to this context', tag: 'Context', keys: [c, '@' + c], run: () => onScope({ areaId: null, context: c }) })
  }
  // Offer a clear only when a scope is actually active.
  if (filter && (filter.areaId || filter.context)) {
    out.push({ kind: 'command', id: 'clear-filter', title: 'Clear board filter', subtitle: 'Show tasks from all areas & contexts', icon: clearFilterIcon, priority: 2, tag: 'Command', keys: ['Clear board filter', 'clear filter', 'show all', 'unfilter', 'reset scope'], run: () => onScope({ areaId: null, context: null }) })
  }

  // Live tasks (open only — completed ones would flood content search).
  for (const t of tasks) {
    if (!t || t.done || t.id == null) continue
    const c = dueChip ? dueChip(t.due_date) : null
    out.push({
      kind: 'task', id: 'task-' + t.id, title: t.title || '(untitled task)',
      subtitle: c ? c.label : 'Task', tag: 'Task', run: () => onRevealTask(t.id),
    })
  }

  // Notes.
  for (const n of (notes || [])) {
    out.push({
      kind: 'note', id: 'note-' + n.path, title: n.title, subtitle: n.folder || '', folder: n.folder,
      tag: 'Note', run: () => onOpenNote(n.path),
    })
  }
  return out
}
