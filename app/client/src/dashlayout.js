// Pure grid/layout math for the dashboard — no React/DOM so the framework-free
// node tests can exercise it (test/dashlayout.test.mjs).

// Fine-grained columns (= the original 12/10/6/4/2 × 2.5) so widgets resize in
// small steps and don't feel too coarse on wide screens. Because every breakpoint
// is the same multiple of the original, any older saved layout scales up by a
// single factor (see SCALE_TO_CURRENT). GRID_V bumps when these change.
export const COLS = { lg: 30, md: 25, sm: 15, xs: 10, xxs: 5 }
export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
export const GRID_V = 3
// Multiply a saved layout's x/w by this to reach the current grid, keyed by the
// layout's stored gridV (1 = old 12-col, 2 = 24-col, 3 = current 30-col).
export const SCALE_TO_CURRENT = { 1: 2.5, 2: 1.25, 3: 1 }

export const DEFAULT_SIZE = { w: 10, h: 9 } // a default widget spans ~1/3 at lg (10 of 30)

// Scale a saved layout's x/w by a factor when the column count changes (heights
// are left alone). Used to upgrade old 12/24-column layouts to the current grid.
export function scaleLayouts(layouts, f) {
  const out = {}
  for (const bp of Object.keys(layouts || {})) out[bp] = (layouts[bp] || []).map((it) => ({ ...it, x: Math.round((it.x || 0) * f), w: Math.max(2, Math.round((it.w || 1) * f)) }))
  return out
}

// Layouts for a fresh board: `widgets` ({ i, type }) placed left to right on
// row 0 at every breakpoint, each at sizeFor(type).
export function defaultLayouts(widgets, sizeFor) {
  const lay = {}
  for (const bp of Object.keys(COLS)) {
    let x = 0
    lay[bp] = widgets.map((w) => {
      const s = sizeFor(w.type)
      const item = { i: w.i, x: x % COLS[bp], y: 0, w: s.w, h: s.h }
      x += s.w
      return item
    })
  }
  return lay
}

// Append one new item below everything else at every breakpoint. y must stay
// finite (Infinity would persist as null in JSON and corrupt the saved layout).
export function appendToLayouts(layouts, id, size) {
  const next = { ...layouts }
  for (const bp of Object.keys(COLS)) {
    const items = next[bp] || []
    const y = items.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 0)), 0)
    next[bp] = [...items, { i: id, x: 0, y, w: size.w, h: size.h }]
  }
  return next
}
