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
