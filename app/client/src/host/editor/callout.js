// Callout (Obsidian admonition) helpers — pure string logic so the node test can
// run them without Tiptap. On disk a callout is a blockquote whose first line is
// `[!TYPE]`, e.g.  > [!NOTE]  /  > body. Unknown types fall back to `note`; if
// the promotion ever fails on load the content survives as a plain blockquote.
export const CALLOUT_TYPES = ['note', 'info', 'tip', 'warning', 'danger']
const LABELS = { note: 'Note', info: 'Info', tip: 'Tip', warning: 'Warning', danger: 'Danger' }

export const normalizeCalloutType = (t) => (CALLOUT_TYPES.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : 'note')
export const calloutLabel = (type) => LABELS[normalizeCalloutType(type)]

// Parse a callout header `[!TYPE]` (optionally followed by a title we ignore).
// Returns { type } or null when the text isn't a callout header.
export function parseCalloutHeader(text) {
  const m = /^\s*\[!([A-Za-z]+)\]/.exec(String(text || ''))
  return m ? { type: normalizeCalloutType(m[1]) } : null
}

// The header token written to disk for a given type, e.g. '[!WARNING]'.
export const calloutHeaderLine = (type) => `[!${normalizeCalloutType(type).toUpperCase()}]`

// Strip a leading `[!TYPE]` token (and one following space) from a line of text.
export const stripCalloutHeader = (text) => String(text || '').replace(/^\s*\[!\w+\]\s?/, '')
