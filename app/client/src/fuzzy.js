// Tiny fuzzy subsequence matcher (fzy / fuzzysort-style), used by the command
// palette quick-switcher and the [[wikilink]] autocomplete. No React/DOM deps so
// the framework-free node tests can exercise it directly.

// Match `query` as an in-order subsequence of `text`. Returns { score, positions }
// or null when `query` isn't a subsequence. Scoring rewards matches that are
// consecutive, at word boundaries (start / after a separator / camelCase hump),
// and near the start; a small length penalty makes a denser match win ties.
export function fuzzyMatch(query, text) {
  const q = String(query == null ? '' : query)
  const t = String(text == null ? '' : text)
  if (!q) return { score: 0, positions: [] }
  const ql = q.toLowerCase()
  const tl = t.toLowerCase()
  const positions = []
  let score = 0
  let from = 0
  let prev = -2
  for (let qi = 0; qi < ql.length; qi++) {
    const ch = ql[qi]
    let found = -1
    for (let k = from; k < tl.length; k++) { if (tl[k] === ch) { found = k; break } }
    if (found === -1) return null
    let s = 1                              // base point for the matched char
    if (found === prev + 1) s += 4         // consecutive run
    const before = found > 0 ? t[found - 1] : ''
    const boundary = found === 0 || /[\s/\-_.]/.test(before) || (/[a-z]/.test(before) && /[A-Z]/.test(t[found]))
    if (boundary) s += 3                   // word-boundary hit
    if (found < 10) s += (10 - found) * 0.1 // earlier is better (decays)
    score += s
    positions.push(found)
    prev = found
    from = found + 1
  }
  score -= (tl.length - ql.length) * 0.01  // prefer the shorter / denser text
  return { score, positions }
}

// Rank items by fuzzyMatch on keyFn(item), dropping non-matches. An empty query
// returns every item (unscored, original order) so the switcher lists all notes
// on open. Ties break toward the shorter key.
export function fuzzyRank(query, items, keyFn = (x) => x) {
  const q = String(query == null ? '' : query).trim()
  if (!q) return items.map((item) => ({ item, score: 0, positions: [] }))
  const out = []
  for (const item of items) {
    const m = fuzzyMatch(q, keyFn(item))
    if (m) out.push({ item, score: m.score, positions: m.positions })
  }
  out.sort((a, b) => b.score - a.score || String(keyFn(a.item)).length - String(keyFn(b.item)).length)
  return out
}
