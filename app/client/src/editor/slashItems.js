// Slash-menu item registry + filter. Pure (no editor/JSX deps) so the node tests
// can exercise the filtering. The actual insert actions live in SlashCommand.js,
// keyed by `id`, so this module stays editor-free.
export const SLASH_ITEMS = [
  { id: 'h1', title: 'Heading 1', group: 'Headings', aliases: ['title', 'h1', 'big'] },
  { id: 'h2', title: 'Heading 2', group: 'Headings', aliases: ['h2', 'subtitle'] },
  { id: 'h3', title: 'Heading 3', group: 'Headings', aliases: ['h3', 'small'] },
  { id: 'bullet', title: 'Bullet list', group: 'Lists', aliases: ['ul', 'unordered', 'list'] },
  { id: 'ordered', title: 'Numbered list', group: 'Lists', aliases: ['ol', 'ordered', 'number'] },
  { id: 'task', title: 'Checklist', group: 'Lists', aliases: ['todo', 'task', 'check', 'checkbox'] },
  { id: 'quote', title: 'Quote', group: 'Blocks', aliases: ['blockquote', 'cite'] },
  { id: 'callout', title: 'Callout', group: 'Blocks', aliases: ['admonition', 'note', 'info', 'warning', 'tip'] },
  { id: 'code', title: 'Code block', group: 'Blocks', aliases: ['codeblock', 'pre', 'fence', 'snippet'] },
  { id: 'table', title: 'Table', group: 'Blocks', aliases: ['grid', 'spreadsheet'] },
  { id: 'divider', title: 'Divider', group: 'Blocks', aliases: ['hr', 'rule', 'separator', 'line'] },
]

// Filter + rank items for a query: prefix matches (on title or any alias) rank
// above substring matches; an empty query returns the full list in order.
export function filterSlashItems(query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  const starts = [], contains = []
  for (const it of SLASH_ITEMS) {
    const hay = [it.title, ...(it.aliases || [])].map((s) => s.toLowerCase())
    if (hay.some((h) => h.startsWith(q))) starts.push(it)
    else if (hay.some((h) => h.includes(q))) contains.push(it)
  }
  return [...starts, ...contains]
}
