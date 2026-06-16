// Word count / reading time for a note body. Pure (node-tested). Strips markdown
// noise (frontmatter, code, link URLs, markers) so the count reflects prose.
const FM = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

export function stripForCount(md) {
  let s = String(md || '').replace(FM, '')
  s = s.replace(/```[\s\S]*?```/g, ' ')                       // fenced code
  s = s.replace(/`[^`]*`/g, ' ')                              // inline code
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                 // images
  s = s.replace(/\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g, '$1')  // wikilink -> target/alias text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')               // [text](url) -> text
  s = s.replace(/^[ \t]*([#>*+-]|\d+\.)[ \t]+/gm, '')         // block markers
  s = s.replace(/[*_~]/g, '')                                 // emphasis
  return s
}

export function wordCount(md) {
  const m = stripForCount(md).trim().match(/[^\s]+/g)
  return m ? m.length : 0
}

export function charCount(md) {
  return stripForCount(md).replace(/\s+/g, '').length
}

// ~200 wpm, at least 1 minute for any non-empty note.
export const readingTime = (words) => Math.max(1, Math.round((words || 0) / 200))
