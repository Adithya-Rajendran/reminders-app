// Pure helpers for note image/drawing references. Dependency-free (no Tiptap)
// so the editor and the resizable-image node can share them and they can be
// unit-tested. On disk, refs are relative (_resources/…) and portable; in the
// editor they are loadable URLs. Image width rides in the URL #fragment (#w640)
// so it round-trips through plain Markdown; a ?query is runtime-only (cache-bust).
export const RES_PREFIX = '/api/notes/resources/'

export const isDrawing = (src) => /\.excalidraw\.png([?#]|$)/.test(src || '')
export const drawingId = (src) => { const m = /([^/]+)\.excalidraw\.png/.exec(src || ''); return m ? m[1] : null }

// The Excalidraw scene resource name for any image src — its basename minus the
// image extension, ensured to end in `.excalidraw`. Handles both the current
// embed (`<id>.excalidraw.png` → `<id>.excalidraw`) and the older one
// (`<id>.png` → `<id>.excalidraw`). null for a src with no basename. A regular
// photo just yields a name whose scene won't exist (so it's treated as non-editable).
export const sceneNameFor = (src) => {
  const base = (String(src || '').split('/').pop() || '').split(/[?#]/)[0].replace(/\.(png|jpe?g|webp|gif|svg)$/i, '')
  if (!base) return null
  return /\.excalidraw$/i.test(base) ? base : base + '.excalidraw'
}

export const toDisplay = (md) => String(md || '').replace(/\]\(_resources\//g, '](' + RES_PREFIX)
export const toDisk = (md) => String(md || '').replace(
  /\]\(\/api\/notes\/resources\/([^)\s?#]+)(\?[^)\s#]*)?(#[^)\s]*)?\)/g,
  (_m, p, _q, frag) => '](_resources/' + p + (frag || '') + ')',
)

// The URL #fragment (carries the image width, e.g. "w640").
const fragOf = (src) => (/#(.*)$/.exec(src || '') || ['', ''])[1]
export const widthOf = (src) => { const m = /(?:^|;)w(\d+)/.exec(fragOf(src)); return m ? +m[1] : null }
export const withWidth = (src, w) => { const f = /#.*$/.exec(src || ''); const head = f ? src.slice(0, f.index) : (src || ''); return head + (w ? '#w' + w : '') }

export const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

// ---- folder path helpers (notes tree) ----
export const parentFolder = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
// Every prefix of "a/b/c" -> ['a', 'a/b', 'a/b/c'] (the path itself included) —
// used to expand a folder and all of its ancestors in the tree.
export const ancestorsOf = (p) => String(p || '').split('/').filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join('/'))
