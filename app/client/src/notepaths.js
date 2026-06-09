// Pure helpers for note image/drawing references. Dependency-free (no Tiptap)
// so the editor and the resizable-image node can share them and they can be
// unit-tested. On disk, refs are relative (_resources/…) and portable; in the
// editor they are loadable URLs. Image width rides in the URL #fragment (#w640)
// so it round-trips through plain Markdown; a ?query is runtime-only (cache-bust).
export const RES_PREFIX = '/api/notes/resources/'

export const isDrawing = (src) => /\.excalidraw\.png([?#]|$)/.test(src || '')
export const drawingId = (src) => { const m = /([^/]+)\.excalidraw\.png/.exec(src || ''); return m ? m[1] : null }

export const toDisplay = (md) => String(md || '').replace(/\]\(_resources\//g, '](' + RES_PREFIX)
export const toDisk = (md) => String(md || '').replace(
  /\]\(\/api\/notes\/resources\/([^)\s?#]+)(\?[^)\s#]*)?(#[^)\s]*)?\)/g,
  (_m, p, _q, frag) => '](_resources/' + p + (frag || '') + ')',
)

export const fragOf = (src) => (/#(.*)$/.exec(src || '') || ['', ''])[1]
export const widthOf = (src) => { const m = /(?:^|;)w(\d+)/.exec(fragOf(src)); return m ? +m[1] : null }
export const withWidth = (src, w) => { const f = /#.*$/.exec(src || ''); const head = f ? src.slice(0, f.index) : (src || ''); return head + (w ? '#w' + w : '') }

export const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
