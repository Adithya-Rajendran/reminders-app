// Extract a note's heading outline from its markdown body. Pure (no DOM) so it's
// node-tested; the editor renders headings in the same document order, so the
// outline index maps 1:1 to the Nth heading element for click-to-scroll.

const slugify = (s) => String(s).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

// Returns [{ level, text, slug }] for ATX headings (# .. ######), skipping any
// inside fenced code blocks. Slugs are GitHub-style and de-duplicated (-1, -2…).
export function extractOutline(markdown) {
  const lines = String(markdown || '').split('\n')
  const out = []
  const seen = new Map()
  let inFence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const level = m[1].length
    const text = m[2].trim()
    if (!text) continue
    let slug = slugify(text) || 'section'
    const n = seen.get(slug) || 0
    seen.set(slug, n + 1)
    if (n) slug = `${slug}-${n}`
    out.push({ level, text, slug })
  }
  return out
}
