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
export const GRID_V = 5
// Multiply a saved layout's x/w by this to reach the current grid, keyed by the
// layout's stored gridV (1 = old 12-col, 2 = 24-col, 3+ = current 30-col base).
// v4/v5 did NOT change the base columns (factor 1, same as v3); the bumps are
// stamps that a board's ultrawide tiers must be rebuilt from the base layout on
// load (see Dashboard.jsx) — v4 rebuilt them at constant size, v5 rebuilds them
// scaled-to-fill — so both scale the base by 1.
export const SCALE_TO_CURRENT = { 1: 2.5, 2: 1.25, 3: 1, 4: 1, 5: 1 }

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

// Proportionally scale a layout's x/w to a wider column count, preserving each
// widget's ROW (y) — so a sparse board fills the extra width instead of leaving
// a right-side void, while keeping the user's row arrangement. Widths are clamped
// to the tier and x kept in range. Heights/rows are untouched.
function scaleItems(items, cols, f) {
  return (items || []).map((it) => {
    const w = Math.max(2, Math.min(cols, Math.round((it.w || 1) * f)))
    const x = Math.max(0, Math.min(Math.round((it.x || 0) * f), cols - w))
    return { ...it, x, w, y: Math.max(0, Math.round(it.y || 0)), h: Math.max(1, Math.round(it.h || 1)) }
  })
}

// Fill in any breakpoint that has no saved layout from the densest one present
// (usually lg). Older boards predate the ultrawide tiers (xl…xxxxl), so without
// this react-grid-layout would clone lg's columns and leave the right of a wide
// canvas empty. Two regimes:
//   • WIDER tiers (more columns than the source) → scale widget x/w to FILL the
//     width, preserving rows. A sparse board (e.g. 3 widgets) thus spreads across
//     the ultrawide screen rather than hugging the left third. The ~66ch text cap
//     (styles.css) keeps the now-wider widgets readable.
//   • NARROWER/equal tiers → constant-size shelf repack, so phones/tablets stack
//     widgets at their normal size (unchanged).
// Non-mutating. No source breakpoint present -> returned untouched.
export function fillBreakpoints(layouts) {
  const out = { ...(layouts || {}) }
  const present = Object.keys(COLS).filter((bp) => Array.isArray(out[bp]))
  if (!present.length) return out
  const source = present.reduce((a, b) => (COLS[b] > COLS[a] ? b : a))
  for (const bp of Object.keys(COLS)) {
    if (Array.isArray(out[bp])) continue
    out[bp] = COLS[bp] > COLS[source]
      ? scaleItems(out[source], COLS[bp], COLS[bp] / COLS[source])
      : repack(out[source], COLS[bp])
  }
  return out
}

// Stamp per-widget size constraints (Apple-style floors + ceilings + resize policy)
// onto every layout item, keyed by widget type via `widgets` ({ i, type }). The
// host (compositor) half of a Wayland xdg_toplevel / ICCCM WM_NORMAL_HINTS-style
// contract: a widget DECLARES size hints in the manifest, the dashboard NEGOTIATES
// and ENFORCES them. constraintsFor(type) returns the unified shape
//   { min:{w,h}, max?:{w,h}, aspect?:{min,max}, resizable?:boolean, resizeHandles?:[] }
// and react-grid-layout reads minW/minH/maxW/maxH/isResizable/resizeHandles off each
// item. Derived at render from the registry rather than persisted — constraints are
// cheap to recreate and should track the current registry, so saved layouts never
// need migrating. Only ADDS min*/max*/isResizable/resizeHandles; never touches
// x/y/w/h, so it can't feed a changed layout back through onLayoutChange and loop.
// `aspect` is NOT stamped here (RGL has no aspect item prop) — it's enforced on
// resize (Dashboard's onResize) and on first render via a contract-checked
// defaultSize. Non-mutating.
export function applyConstraints(layouts, widgets, constraintsFor) {
  const typeById = new Map((widgets || []).map((w) => [w.i, w.type]))
  const out = {}
  for (const bp of Object.keys(layouts || {})) {
    out[bp] = (layouts[bp] || []).map((it) => {
      const c = constraintsFor(typeById.get(it.i)) || {}
      const min = c.min || {}
      const floorW = Math.max(1, Math.round(min.w || 1))
      const floorH = Math.max(1, Math.round(min.h || 1))
      // Never let a floor exceed the item's current size (that would force RGL to
      // grow it on load); clamp the floor to what's already placed.
      const minW = Math.min(floorW, it.w || floorW)
      const minH = Math.min(floorH, it.h || floorH)
      const stamped = { ...it, minW, minH }
      if (c.max) {
        // Never let a ceiling fall below the item's current size (RGL would force-
        // shrink a saved-large item) or below the floor (RGL misbehaves if max<min):
        // clamp the ceiling UP to whichever is larger. The next resize lands inside
        // the real max — non-destructive on load.
        stamped.maxW = Math.max(Math.round(c.max.w), it.w || 1, minW)
        stamped.maxH = Math.max(Math.round(c.max.h), it.h || 1, minH)
      }
      // Resize policy: a widget can lock its size or restrict which handles resize it.
      if (c.resizable === false) stamped.isResizable = false
      if (Array.isArray(c.resizeHandles)) stamped.resizeHandles = c.resizeHandles
      return stamped
    })
  }
  return out
}

// Snap a proposed size onto an aspect band. `aspect` is { min, max } — the allowed
// width/height ratio range in GRID CELLS (a fixed ratio is the band { min:r, max:r }).
// Height is the anchor (rowHeight is constant, and "tall enough to read" dominates
// for these content widgets): if the ratio falls outside the band, width is re-derived
// from height at the nearer band edge. Returns integer { w, h }; a falsy aspect is the
// identity. Pure + deterministic so the node tests exercise it without a renderer; the
// dashboard's onResize handler composes it with the item's own min/max clamp.
export function clampAspect(w, h, aspect) {
  const hh = Math.max(1, Math.round(h))
  const ww = Math.max(1, Math.round(w))
  if (!aspect) return { w: ww, h: hh }
  const r = ww / hh
  if (r >= aspect.min && r <= aspect.max) return { w: ww, h: hh }
  const edge = r < aspect.min ? aspect.min : aspect.max
  return { w: Math.max(1, Math.round(hh * edge)), h: hh }
}

// Shelf-pack `items` into `cols` columns at their existing size. Walk them in
// reading order (top rows first, then left-to-right) and lay each on the current
// shelf; once the next item won't fit, start a new shelf below the tallest item
// on the current one. Widget w/h are preserved (w clamped to [2, cols] only as a
// safety net — wider tiers only ever add room). The shelf y is just a collision-
// free, monotonic starting point: react-grid-layout's vertical compactor tightens
// each column at render, so uneven heights within a shelf leave no permanent gap.
// Non-mutating (items are copied before sorting) and idempotent.
export function repack(items, cols) {
  const sorted = (items || []).map((it) => ({ ...it })).sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))
  let cursorX = 0, shelfY = 0, shelfH = 0
  return sorted.map((it) => {
    const w = Math.max(2, Math.min(cols, Math.round(it.w || 1)))
    const h = Math.max(1, Math.round(it.h || 1))
    if (cursorX > 0 && cursorX + w > cols) { shelfY += shelfH; cursorX = 0; shelfH = 0 }
    const x = Math.min(cursorX, cols - w)
    const placed = { ...it, x, y: shelfY, w, h }
    cursorX = x + w
    shelfH = Math.max(shelfH, h)
    return placed
  })
}
