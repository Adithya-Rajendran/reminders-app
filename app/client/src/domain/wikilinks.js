// Wikilink helpers — pure so the node tests can run them. On disk a wikilink is
// plain text `[[Target]]` or `[[Target|Alias]]` (Obsidian/Foam portable). The
// editor keeps it as text too and only *decorates* it, so round-trip is exact.
export const WIKILINK_RE = /\[\[([^\]\n]+?)\]\]/g

export function parseWikilink(inner) {
  const [target, ...rest] = String(inner || '').split('|')
  return { target: target.trim(), alias: rest.join('|').trim() }
}

export function serializeWikilink({ target, alias } = {}) {
  const t = String(target || '').trim()
  const a = String(alias || '').trim()
  return a ? `[[${t}|${a}]]` : `[[${t}]]`
}

// The text to show for a wikilink (alias if present, else target).
export const wikilinkLabel = (inner) => { const { target, alias } = parseWikilink(inner); return alias || target }

// Whether a `[[` suggestion trigger at `pos` falls inside an already-complete
// [[...]] range. Clicking a wikilink parks the caret inside the link text, and
// without this guard the autocomplete would open there — one Enter away from
// splicing `[[title]]` into the middle of the existing link (leaving orphaned
// brackets), possibly after the click has already swapped the editor to the
// target note. `pos` is the match start (the `[[`), so a match that begins
// anywhere inside a complete link — including one whose query would swallow
// the closing `]]` — is rejected.
export const insideWikilink = (ranges, pos) => (ranges || []).some((r) => pos >= r.from && pos < r.to)

// Resolve a target (a note title) to a note from the list. Case-insensitive; on a
// title collision prefer the same folder, then the most recently updated.
export function resolveWikilink(target, notes, fromFolder = '') {
  const t = String(target || '').trim().toLowerCase()
  if (!t) return null
  const cands = (notes || []).filter((n) => String(n.title || '').trim().toLowerCase() === t)
  if (cands.length <= 1) return cands[0] || null
  return cands.slice().sort((a, b) => {
    const af = (a.folder || '') === fromFolder ? 0 : 1
    const bf = (b.folder || '') === fromFolder ? 0 : 1
    return af - bf || String(b.updated || '').localeCompare(String(a.updated || ''))
  })[0]
}
