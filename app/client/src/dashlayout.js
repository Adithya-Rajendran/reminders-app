// Pure grid/layout math for the dashboard — no React/DOM so the framework-free
// node tests can exercise it (test/dashlayout.test.mjs).

// Fine-grained columns so widgets resize in small steps and don't feel too coarse
// on wide screens. Two groups of tiers:
//
//   • The original five (lg…xxs) = the original 12/10/6/4/2 × 2.5. Because every
//     one is the same multiple of the original, any older saved layout scales up
//     by a single factor (see SCALE_TO_CURRENT). GRID_V bumps when THESE change.
//
//   • The ultrawide tiers (xl…xxxxl) are *additive* — they never appear in old
//     saved layouts, so the single-factor migration never touches them and adding
//     them needs no GRID_V bump. They exist so the (uncapped, see --canvas-max in
//     styles.css) canvas turns extra width into more columns instead of stretching
//     widgets: each tier keeps the design's ~40px column-pitch floor (width ÷ cols
//     ≈ 40 at the breakpoint), so pitch stays in a comfortable ~40–60px band up to
//     5120px and only stretches gently beyond (≈80px at 10240px). Breakpoints are
//     matched against the measured container width (screen minus padding), not the
//     raw screen width, so the exact tier boundary is approximate by design.
export const COLS = { xxxxl: 128, xxxl: 96, xxl: 64, xl: 45, lg: 30, md: 25, sm: 15, xs: 10, xxs: 5 }
export const BREAKPOINTS = { xxxxl: 5120, xxxl: 3840, xxl: 2560, xl: 1800, lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
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

// Fill in any breakpoint that has no saved layout by proportionally scaling the
// densest breakpoint that DOES (usually lg). Older boards predate the ultrawide
// tiers (xl…xxxxl), so without this they'd hit a wide screen with those tiers
// missing — react-grid-layout would clone lg's 0–30 column positions and leave
// the right ~75% of the canvas empty. Scaling instead keeps each widget's
// relative position/size, so the board looks full on first load (and, being on a
// denser grid, can then be packed tighter). Non-mutating; reuses the round/clamp
// idiom from scaleLayouts. No source breakpoint present -> returned untouched.
export function fillBreakpoints(layouts) {
  const out = { ...(layouts || {}) }
  const present = Object.keys(COLS).filter((bp) => Array.isArray(out[bp]))
  if (!present.length) return out
  const source = present.reduce((a, b) => (COLS[b] > COLS[a] ? b : a))
  for (const bp of Object.keys(COLS)) {
    if (Array.isArray(out[bp])) continue
    const f = COLS[bp] / COLS[source]
    out[bp] = out[source].map((it) => {
      const w = Math.max(2, Math.min(COLS[bp], Math.round((it.w || 1) * f)))
      const x = Math.min(Math.max(0, Math.round((it.x || 0) * f)), COLS[bp] - w)
      return { ...it, x, w }
    })
  }
  return out
}
