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
