// Note sort orders for the sidebar list/tree. Pure (node-tested). created/updated
// are ISO strings, so a lexical compare is chronological.
export const SORTS = [
  { key: 'updated', label: 'Last updated' },
  { key: 'created', label: 'Date created' },
  { key: 'title-asc', label: 'Title A–Z' },
  { key: 'title-desc', label: 'Title Z–A' },
]

const desc = (field) => (a, b) => String(b[field] || '').localeCompare(String(a[field] || ''))
const byTitle = (dir) => (a, b) => dir * String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
const CMP = {
  updated: desc('updated'),
  created: desc('created'),
  'title-asc': byTitle(1),
  'title-desc': byTitle(-1),
}

// Stable, non-mutating sort by sort key (unknown key falls back to updated).
export const sortNotes = (list, key) => (list || []).slice().sort(CMP[key] || CMP.updated)
