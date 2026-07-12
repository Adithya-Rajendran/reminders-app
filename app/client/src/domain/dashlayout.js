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
// load (see Dashboard.jsx) — v4 rebuilt them at constant size, while v5 scales
// their widths and packs them into a centered block — so both scale the base by 1.
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

// Next free slot for a w×h widget, scanning top→bottom then left→right (first-fit):
// the widget flows into the next open spot on the RIGHT of a partly-filled row (or
// a gap a removed widget left behind) and only wraps to a new row when the current
// rows are full. Compaction-stable: the returned y is the smallest row with a free
// w-wide slot, so the grid's vertical compactor can't pull the widget up into a
// collision. Pure + node-tested.
export function nextSlot(items, cols, w, h) {
  const ww = Math.max(1, Math.min(cols, Math.round(w)))
  const hh = Math.max(1, Math.round(h))
  const list = items || []
  const hits = (x, y) => list.some((it) => {
    const ix = it.x || 0, iy = it.y || 0, iw = it.w || 1, ih = it.h || 1
    return x < ix + iw && ix < x + ww && y < iy + ih && iy < y + hh
  })
  const maxY = list.reduce((m, it) => Math.max(m, (it.y || 0) + (it.h || 0)), 0)
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + ww <= cols; x++) {
      if (!hits(x, y)) return { x, y }
    }
  }
  return { x: 0, y: maxY } // every row is full -> start a fresh row at the left
}

// Place one new item in the next free slot (flow right, wrap down) at every
// breakpoint. y must stay finite (Infinity would persist as null in JSON and
// corrupt the saved layout).
export function appendToLayouts(layouts, id, size) {
  const next = { ...layouts }
  for (const bp of Object.keys(COLS)) {
    const items = next[bp] || []
    const w = Math.max(1, Math.min(COLS[bp], size.w))
    const { x, y } = nextSlot(items, COLS[bp], w, size.h)
    next[bp] = [...items, { i: id, x, y, w, h: size.h }]
  }
  return next
}

// Keep an auto-widened width inside a widget's cohesive shape: clamp it DOWN to
// the max ceiling and the wide edge of the aspect band (anchored on height, like
// clampAspect). Only ever shrinks w — so a scaled, non-overlapping row stays
// non-overlapping (a sparse board may leave a gap rather than stretch a widget
// past its band). A falsy contract is the identity. Pure + node-tested.
export function fitWidthToContract(c, w, h) {
  let out = Math.max(1, Math.round(w))
  if (!c) return out
  if (c.max) out = Math.min(out, Math.max(1, Math.round(c.max.w)))
  if (c.aspect) out = Math.min(out, Math.max(1, Math.round(Math.max(1, Math.round(h)) * c.aspect.max)))
  return Math.max(1, out)
}

// Proportionally scale a layout's x/w to a wider column count, preserving each
// widget's ROW (y). Widths are clamped to the tier and x kept in range;
// packAndCenter then removes the gaps left by contract-clamped widths. Heights /
// rows are untouched. With a
// `getConstraints(id)` accessor, the auto-widened width is additionally clamped
// into the widget's aspect band + ceiling.
function scaleItems(items, cols, f, getConstraints) {
  return (items || []).map((it) => {
    const h = Math.max(1, Math.round(it.h || 1))
    let w = Math.max(2, Math.min(cols, Math.round((it.w || 1) * f)))
    if (getConstraints) w = Math.max(2, Math.min(cols, fitWidthToContract(getConstraints(it.i), w, h)))
    const x = Math.max(0, Math.min(Math.round((it.x || 0) * f), cols - w))
    return { ...it, x, w, y: Math.max(0, Math.round(it.y || 0)), h }
  })
}

// Pack an existing layout horizontally without changing its rows or sizes. Items
// are processed in reading order and placed in the first collision-free x cell;
// the resulting occupied block is then centered in the tier. The normalized
// source is returned if an anomalous layout has no legal horizontal placement,
// rather than introducing a collision or moving an item vertically.
// Non-mutating, deterministic, and idempotent for valid RGL layouts.
export function packAndCenter(items, cols) {
  const cc = Math.max(1, Math.round(cols || 1))
  const normalized = (items || []).map((it) => {
    const w = Math.max(1, Math.min(cc, Math.round(it.w || 1)))
    return {
      ...it,
      x: Math.max(0, Math.min(cc - w, Math.round(it.x || 0))),
      y: Math.max(0, Math.round(it.y || 0)),
      w,
      h: Math.max(1, Math.round(it.h || 1)),
    }
  }).sort((a, b) => a.y - b.y || a.x - b.x)
  if (!normalized.length) return normalized

  const placed = []
  const collides = (candidate) => placed.some((it) => (
    candidate.x < it.x + it.w && it.x < candidate.x + candidate.w &&
    candidate.y < it.y + it.h && it.y < candidate.y + candidate.h
  ))
  for (const it of normalized) {
    let x = 0
    while (x + it.w <= cc && collides({ ...it, x })) x++
    if (x + it.w > cc) return normalized
    placed.push({ ...it, x })
  }

  const right = placed.reduce((max, it) => Math.max(max, it.x + it.w), 0)
  const shift = Math.floor((cc - right) / 2)
  return placed.map((it) => ({ ...it, x: it.x + shift }))
}

// Fill in any breakpoint that has no saved layout from the densest one present
// (usually lg). Older boards predate the ultrawide tiers (xl…xxxxl), so without
// this react-grid-layout would clone lg's columns and leave the right of a wide
// canvas empty. Two regimes:
//   • WIDER tiers (more columns than the source) → scale widget widths, clamp
//     them to their contracts, then pack + center a cohesive block while keeping
//     every row unchanged.
//   • NARROWER/equal tiers → constant-size shelf repack, so phones/tablets stack
//     widgets at their normal size (unchanged).
// Non-mutating. No source breakpoint present -> returned untouched. `getConstraints`
// (optional) keeps the fill inside each widget's aspect band + max on wider tiers.
export function fillBreakpoints(layouts, getConstraints) {
  const out = { ...(layouts || {}) }
  const present = Object.keys(COLS).filter((bp) => Array.isArray(out[bp]))
  if (!present.length) return out
  const source = present.reduce((a, b) => (COLS[b] > COLS[a] ? b : a))
  for (const bp of Object.keys(COLS)) {
    if (Array.isArray(out[bp])) continue
    if (COLS[bp] > COLS[source]) {
      const scaled = scaleItems(out[source], COLS[bp], COLS[bp] / COLS[source], getConstraints)
      out[bp] = packAndCenter(scaled, COLS[bp])
    } else {
      out[bp] = repack(out[source], COLS[bp])
    }
  }
  return out
}

// Ultrawide tiers are generated from the base when missing. Older grid versions
// can contain stale generated copies, so migrations strip those tiers before
// rebuilding them; current-version tiers may be user-authored and are preserved.
export const DERIVED_TIERS = ['xl', 'xxl', 'xxxl', 'xxxxl']
export function stripDerivedTiers(layouts) {
  const out = {}
  for (const bp of Object.keys(layouts || {})) { if (!DERIVED_TIERS.includes(bp)) out[bp] = layouts[bp] }
  return out
}

// Canonical signature of the PERSISTED board state: widget identity/type/group +
// every authored-tier placement, ignoring stamped constraint props
// (minW/maxW/isResizable/…) and item order. Lets the dashboard skip no-op saves —
// react-grid-layout fires onLayoutChange on mount and on scrollbar jitter with
// nothing semantically changed. Pure + node-tested.
export function boardSignature(widgets, layouts) {
  const byI = (a, b) => (a.i < b.i ? -1 : a.i > b.i ? 1 : 0)
  // `collapsed` is part of the persisted state (a header-only minimize), so a
  // collapse/expand must count as a real change — otherwise the no-op guard skips it.
  const w = (widgets || []).map(({ i, type, group, collapsed }) => ({ i, type, group: group ?? null, collapsed: !!collapsed })).sort(byI)
  const src = layouts || {}
  const l = {}
  for (const bp of Object.keys(src).sort()) {
    l[bp] = (src[bp] || [])
      .map((it) => ({ i: it.i, x: it.x || 0, y: it.y || 0, w: it.w || 1, h: it.h || 1 }))
      .sort(byI)
  }
  return JSON.stringify({ w, l })
}

// Render-time COLLAPSE: a collapsed widget renders at a fixed header-only height and
// is locked (non-resizable). Layered AFTER applyConstraints and NEVER persisted — the
// source layouts keep the real (expanded) height, so expanding just drops the
// override. `collapsedIds` is a Set of widget instance ids. Non-mutating.
export function applyCollapsed(layouts, collapsedIds, h) {
  if (!collapsedIds || collapsedIds.size === 0) return layouts
  const out = {}
  for (const bp of Object.keys(layouts || {})) {
    out[bp] = (layouts[bp] || []).map((it) => (
      collapsedIds.has(it.i) ? { ...it, h, minH: h, maxH: h, isResizable: false } : it
    ))
  }
  return out
}

// The inverse for onLayoutChange: react-grid-layout reports collapsed items at the
// locked header height, which must not overwrite their real height in state /
// persistence. Restore each collapsed item's height from the source (expanded)
// layouts. Non-mutating.
export function restoreCollapsedHeights(rglLayouts, sourceLayouts, collapsedIds) {
  if (!collapsedIds || collapsedIds.size === 0) return rglLayouts
  const out = {}
  for (const bp of Object.keys(rglLayouts || {})) {
    const src = (sourceLayouts && sourceLayouts[bp]) || []
    out[bp] = (rglLayouts[bp] || []).map((it) => {
      if (!collapsedIds.has(it.i)) return it
      const s = src.find((x) => x.i === it.i)
      return s ? { ...it, h: s.h } : it
    })
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

// Direction-aware aspect snap for live resize commit/preview. Pure horizontal
// drags anchor width, because re-deriving width from height fights the pointer.
// Vertical and corner drags keep clampAspect's height-anchored behavior.
export function snapAspectDrag(oldItem, next, aspect) {
  const ww = Math.max(1, Math.round(next.w))
  const hh = Math.max(1, Math.round(next.h))
  if (!aspect) return { w: ww, h: hh }
  const oldW = Math.max(1, Math.round(oldItem.w))
  const oldH = Math.max(1, Math.round(oldItem.h))
  const wMoved = ww !== oldW
  const hMoved = hh !== oldH
  if (wMoved && !hMoved) {
    const r = ww / hh
    if (r >= aspect.min && r <= aspect.max) return { w: ww, h: hh }
    const edge = r < aspect.min ? aspect.min : aspect.max
    return { w: ww, h: Math.max(1, Math.round(ww / edge)) }
  }
  return clampAspect(ww, hh, aspect)
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
