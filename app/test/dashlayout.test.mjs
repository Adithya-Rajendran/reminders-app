// Pure dashboard grid math: scaleLayouts (old-grid upgrades), defaultLayouts
// (fresh-board placement), appendToLayouts (add-widget placement). Run with:
//   node test/dashlayout.test.mjs
import {
  COLS, BREAKPOINTS, GRID_V, SCALE_TO_CURRENT, DEFAULT_SIZE, DERIVED_TIERS,
  scaleLayouts, defaultLayouts, appendToLayouts, fillBreakpoints, repack, applyConstraints, clampAspect, snapAspectDrag, fitWidthToContract, nextSlot,
  stripDerivedTiers, boardSignature, applyCollapsed, restoreCollapsedHeights,
} from '../client/src/dashlayout.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- invariants the persistence format depends on ---
ok(GRID_V === 5, 'GRID_V is 5 (bump SCALE_TO_CURRENT when changing the grid)')
ok(Object.keys(SCALE_TO_CURRENT).length === GRID_V, 'every historical gridV has a scale factor')
ok(SCALE_TO_CURRENT[GRID_V] === 1, 'the current gridV scales by 1 (no-op)')
for (const [v, f] of Object.entries(SCALE_TO_CURRENT)) {
  ok(COLS.lg === Math.round(COLS.lg / f) * f, `gridV ${v}: lg col count survives a round-trip through factor ${f}`)
}

// --- breakpoint ladder (COLS <-> BREAKPOINTS) ---
ok(Object.keys(COLS).sort().join() === Object.keys(BREAKPOINTS).sort().join(), 'COLS and BREAKPOINTS define the same breakpoints')
// Ascending by width, column counts must strictly increase (a wider canvas only
// ever gets MORE columns) so react-grid-layout picks a denser grid as it grows.
const byWidth = Object.keys(BREAKPOINTS).sort((a, b) => BREAKPOINTS[a] - BREAKPOINTS[b])
ok(byWidth.every((bp, i) => i === 0 || COLS[bp] > COLS[byWidth[i - 1]]), 'columns strictly increase with breakpoint width')
// Every breakpoint above 0 keeps roughly the ~40px column-pitch floor, so widgets
// never balloon on an uncapped ultra-wide canvas (width / cols stays in band).
for (const bp of byWidth) {
  if (!BREAKPOINTS[bp]) continue
  const pitch = BREAKPOINTS[bp] / COLS[bp]
  ok(pitch >= 38 && pitch <= 52, `${bp}: column pitch ${pitch.toFixed(1)}px stays in the ~40px band`)
}

// --- fillBreakpoints (scale-to-fill on WIDER tiers; constant-size repack on narrower) ---
const partial = { lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 20, y: 0, w: 10, h: 9 }] }
const filled = fillBreakpoints(partial)
const fW = COLS.xxxxl / COLS.lg
ok(Object.keys(filled).sort().join() === Object.keys(COLS).sort().join(), 'fills every missing breakpoint from the densest present one')
ok(partial.lg.length === 2 && partial.lg[1].x === 20 && !partial.xxxxl, 'fillBreakpoints is non-mutating')
ok(filled.lg === partial.lg, 'present breakpoints are reused untouched')
// On a WIDER tier widgets scale up proportionally to fill the extra width (no void); height unchanged.
ok(filled.xxxxl.every((it) => it.w === Math.round(10 * fW) && it.h === 9), 'widget width scales to fill a wider tier; height unchanged')
// Rows are preserved and x scales proportionally, staying within the tier.
ok(filled.xxxxl[0].y === 0 && filled.xxxxl[1].y === 0 && filled.xxxxl.map((it) => it.x).join() === `0,${Math.round(20 * fW)}` && filled.xxxxl.every((it) => it.x + it.w <= COLS.xxxxl), 'x scales proportionally and stays within the wider tier')
// Narrower tiers still constant-size repack (phones/tablets stack at normal size).
ok(filled.xs.every((it) => it.x + it.w <= COLS.xs && it.w === 10), 'narrower tiers keep widgets at their original size')
// On a wider tier a lower widget keeps its row (it widens to fill, rather than flowing up).
const stacked = fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 0, y: 9, w: 10, h: 9 }] })
ok(stacked.xxxxl.find((it) => it.i === 'b').y === 9 && stacked.xxxxl.find((it) => it.i === 'b').w === Math.round(10 * fW), 'a lower widget keeps its row and widens to fill on a wider tier')
// Wrapping: at md (25 cols) two 10-wide widgets fit a shelf, the third wraps below.
const wrapped = fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 10, y: 0, w: 10, h: 9 }, { i: 'c', x: 20, y: 0, w: 10, h: 9 }] }).md
ok(wrapped.filter((it) => it.y === 0).length === 2 && wrapped.find((it) => it.i === 'c').x === 0 && wrapped.find((it) => it.i === 'c').y === 9, 'a third widget wraps to a new shelf below (shelf height = max h)')
// repack is idempotent (so onLayoutChange echoes don't drift) and array-safe.
ok(JSON.stringify(repack(repack(partial.lg, 64), 64)) === JSON.stringify(repack(partial.lg, 64)), 'repack is idempotent')
ok(repack([], 30).length === 0 && repack(null, 30).length === 0, 'repack handles empty/null input')
const allThere = defaultLayouts([{ i: 'w-1', type: 'a' }], () => ({ ...DEFAULT_SIZE }))
ok(fillBreakpoints(allThere) !== allThere && Object.keys(fillBreakpoints(allThere)).length === Object.keys(allThere).length, 'a fully-populated layout gains no breakpoints (returns a copy)')
ok(Object.keys(fillBreakpoints(null)).length === 0 && Object.keys(fillBreakpoints({})).length === 0, 'null/empty input -> empty object (no throw)')

// --- fitWidthToContract (keep the auto-fill width inside a widget's band/ceiling) ---
ok(fitWidthToContract(null, 20, 9) === 20, 'no contract -> width unchanged')
ok(fitWidthToContract({ aspect: { min: 0.9, max: 1.4 } }, 20, 9) === Math.round(9 * 1.4), 'aspect clamps width down to the band edge (anchored on height)')
ok(fitWidthToContract({ aspect: { min: 0.9, max: 1.4 } }, 11, 9) === 11, 'a width already inside the band is not shrunk')
ok(fitWidthToContract({ aspect: { min: 0.9, max: 1.4 } }, 5, 9) === 5, 'never widens up to the band min (only ever shrinks)')
ok(fitWidthToContract({ max: { w: 13 } }, 20, 9) === 13, 'max ceiling clamps width')
ok(fitWidthToContract({ max: { w: 10 }, aspect: { min: 0.9, max: 1.4 } }, 20, 9) === 10, 'max + aspect take the tighter bound')

// --- fillBreakpoints with constraints (cohesion: clamp the ultrawide fill into-band) ---
const gcAspect = (id) => (id === 'a' ? { aspect: { min: 0.9, max: 1.4 } } : null)
const clampedFill = fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }] }, gcAspect)
ok(clampedFill.xxxxl[0].w === Math.round(9 * 1.4), 'auto-fill clamps a widget into its aspect band on a wider tier')
ok(clampedFill.xxxxl[0].h === 9, 'the aspect clamp leaves height untouched')
const clampedMax = fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }] }, () => ({ max: { w: 12 } }))
ok(clampedMax.xxxxl[0].w === 12, 'auto-fill clamps a widget to its max width on a wider tier')
// Without constraints the fill is unchanged (back-compat with the calls above).
ok(fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }] }).xxxxl[0].w === Math.round(10 * (COLS.xxxxl / COLS.lg)), 'no constraints -> fill scales to fill as before')

// --- scaleLayouts ---
const old12 = { lg: [{ i: 'a', x: 4, y: 0, w: 4, h: 9 }, { i: 'b', x: 8, y: 9, w: 1, h: 5 }] }
const up = scaleLayouts(old12, 2.5)
ok(up.lg[0].x === 10 && up.lg[0].w === 10, '12-col item x/w scale by 2.5')
ok(up.lg[0].y === 0 && up.lg[0].h === 9, 'heights and y are left alone')
ok(up.lg[1].w === 3, 'rounding applies (1 × 2.5 -> 3)')
ok(scaleLayouts({ lg: [{ i: 'c', x: 0, y: 0, w: 1, h: 2 }] }, 1).lg[0].w === 2, 'scaled width is clamped to >= 2')
ok(Object.keys(scaleLayouts(null, 2.5)).length === 0, 'null layouts -> empty object (no throw)')

// --- defaultLayouts ---
const board = [{ i: 'w-1', type: 'a' }, { i: 'w-2', type: 'b' }, { i: 'w-3', type: 'a' }]
const sizeFor = () => ({ ...DEFAULT_SIZE })
const lay = defaultLayouts(board, sizeFor)
ok(Object.keys(lay).sort().join() === Object.keys(COLS).sort().join(), 'one layout per breakpoint')
ok(lay.lg.map((it) => it.x).join() === '0,10,20', 'lg: three defaults tile left to right (30 cols)')
ok(lay.xxs[1].x === 5 % COLS.xxs && lay.xxs[1].x === 0, 'narrow breakpoints wrap x into range')
ok(lay.lg.every((it) => it.w === DEFAULT_SIZE.w && it.h === DEFAULT_SIZE.h), 'items get sizeFor() size')
const sized = defaultLayouts([{ i: 'w-1', type: 'a' }], () => ({ w: 5, h: 4 }))
ok(sized.lg[0].w === 5 && sized.lg[0].h === 4, 'per-type defaultSize is honored')

// --- appendToLayouts ---
const next = appendToLayouts(lay, 'w-4', { w: 5, h: 7 })
ok(next.lg.length === 4 && lay.lg.length === 3, 'append is non-mutating')
ok(next.lg[3].i === 'w-4' && next.lg[3].x === 0, 'new item starts at x=0')
ok(next.lg[3].y === 9, 'new item lands below the tallest existing item')
ok(Number.isFinite(next.lg[3].y), 'y stays finite (Infinity would persist as null)')
const fromEmpty = appendToLayouts({}, 'w-1', DEFAULT_SIZE)
ok(Object.keys(fromEmpty).length === Object.keys(COLS).length && fromEmpty.lg[0].y === 0, 'append works on an empty board at every breakpoint')
// Flow-right placement: a partly-filled row takes the new widget in its right-hand
// gap (not a new row at the bottom); a full row wraps; an interior gap is filled.
ok(nextSlot([{ x: 0, y: 0, w: 10, h: 9 }, { x: 10, y: 0, w: 10, h: 9 }], 30, 8, 7).x === 20, 'nextSlot flows into the open spot to the right of a partly-filled row')
const flowed = appendToLayouts({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 10, y: 0, w: 10, h: 9 }] }, 'c', { w: 8, h: 7 })
ok(flowed.lg[2].x === 20 && flowed.lg[2].y === 0, 'append flows the new widget right (same row) when there is room')
const wrappedAdd = appendToLayouts({ lg: [{ i: 'a', x: 0, y: 0, w: 15, h: 9 }, { i: 'b', x: 15, y: 0, w: 15, h: 9 }] }, 'c', { w: 10, h: 7 })
ok(wrappedAdd.lg[2].x === 0 && wrappedAdd.lg[2].y === 9, 'a full row wraps the new widget to the next row at x=0')
const filledGap = appendToLayouts({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 20, y: 0, w: 10, h: 9 }] }, 'c', { w: 10, h: 9 })
ok(filledGap.lg[2].x === 10 && filledGap.lg[2].y === 0, 'append fills an interior gap left within a row')

// --- applyConstraints (per-widget floors + ceilings + resize policy) ---
{
  const spec = {
    a: { min: { w: 4, h: 4 }, max: { w: 20, h: 18 } },
    b: { min: { w: 6, h: 5 } },                                  // no ceiling
    locked: { min: { w: 4, h: 4 }, resizable: false },
    corners: { min: { w: 4, h: 4 }, resizeHandles: ['se', 'sw', 'ne', 'nw'] },
  }
  const constraintsFor = (type) => spec[type]
  const base = { lg: [{ i: 'w-1', x: 0, y: 0, w: 10, h: 9 }, { i: 'w-2', x: 10, y: 0, w: 10, h: 9 }] }
  const c = applyConstraints(base, board, constraintsFor) // board: w-1=a, w-2=b
  ok(c.lg[0].minW === 4 && c.lg[0].minH === 4, 'type a gets its floor')
  ok(c.lg[1].minW === 6 && c.lg[1].minH === 5, 'type b gets its floor')
  ok(c.lg[0].maxW === 20 && c.lg[0].maxH === 18, 'type a gets its ceiling')
  ok(c.lg[1].maxW === undefined && c.lg[1].maxH === undefined, 'type b (no maxSize) gets no ceiling')
  ok(base.lg[0].minW === undefined && base.lg[0].maxW === undefined, 'applyConstraints is non-mutating')
  ok(c.lg[0].w === 10 && c.lg[0].h === 9, 'x/y/w/h preserved')
  // a floor must never exceed the item's current size (would force RGL to grow it)
  const tiny = { lg: [{ i: 'w-1', x: 0, y: 0, w: 3, h: 2 }] }
  const clamped = applyConstraints(tiny, [{ i: 'w-1', type: 'b' }], constraintsFor)
  ok(clamped.lg[0].minW === 3 && clamped.lg[0].minH === 2, 'floor clamps down to current size')
  // a ceiling must never fall below the current size (would force RGL to shrink it)
  const big = applyConstraints({ lg: [{ i: 'w-1', x: 0, y: 0, w: 30, h: 25 }] }, [{ i: 'w-1', type: 'a' }], constraintsFor)
  ok(big.lg[0].maxW === 30 && big.lg[0].maxH === 25, 'ceiling clamps up to current size')
  // a ceiling must never fall below the floor (RGL misbehaves if max < min)
  const both = applyConstraints({ lg: [{ i: 'w-1', x: 0, y: 0, w: 2, h: 2 }] }, [{ i: 'w-1', type: 'a' }], constraintsFor)
  ok(both.lg[0].maxW >= both.lg[0].minW && both.lg[0].maxH >= both.lg[0].minH, 'ceiling stays >= floor')
  // resize policy: lock + restricted handles pass through to the RGL item
  const policy = applyConstraints(
    { lg: [{ i: 'l', x: 0, y: 0, w: 6, h: 6 }, { i: 'k', x: 6, y: 0, w: 6, h: 6 }] },
    [{ i: 'l', type: 'locked' }, { i: 'k', type: 'corners' }], constraintsFor)
  ok(policy.lg[0].isResizable === false, 'resizable:false stamps isResizable=false')
  ok(policy.lg[1].isResizable === undefined, 'a resizable widget keeps the RGL default (no isResizable)')
  ok(JSON.stringify(policy.lg[1].resizeHandles) === JSON.stringify(['se', 'sw', 'ne', 'nw']), 'resizeHandles passes through')
  ok(policy.lg[0].resizeHandles === undefined, 'no resizeHandles override when unset')
  // unknown type / missing constraint -> minimum of 1, no throw
  const unknown = applyConstraints({ lg: [{ i: 'x', x: 0, y: 0, w: 5, h: 5 }] }, [{ i: 'x', type: 'gone' }], constraintsFor)
  ok(unknown.lg[0].minW === 1 && unknown.lg[0].minH === 1, 'unknown type floors to 1')
}

// --- clampAspect (snap a size onto an aspect band; height is the anchor) ---
{
  const eq = (got, w, h) => got.w === w && got.h === h
  // fixed ratio = the band where min === max
  ok(eq(clampAspect(10, 5, { min: 1, max: 1 }), 5, 5), 'fixed 1:1 snaps width down to height')
  ok(eq(clampAspect(4, 8, { min: 1, max: 1 }), 8, 8), 'fixed 1:1 grows width up to height')
  ok(eq(clampAspect(6, 6, { min: 1, max: 1 }), 6, 6), 'already 1:1 -> untouched')
  // band {min,max}: correct only when the ratio leaves [min,max]
  ok(eq(clampAspect(20, 5, { min: 1, max: 2 }), 10, 5), 'too wide -> pulled to the max edge (2 * 5)')
  ok(eq(clampAspect(3, 5, { min: 1, max: 2 }), 5, 5), 'too narrow -> pulled to the min edge (1 * 5)')
  ok(eq(clampAspect(8, 5, { min: 1, max: 2 }), 8, 5), 'inside the band -> untouched')
  // no aspect -> identity (still floors a degenerate size to >= 1)
  ok(eq(clampAspect(7, 4, null), 7, 4), 'no aspect -> identity')
  ok(eq(clampAspect(0, 0, null), 1, 1), 'degenerate size floors to 1')
}

// --- snapAspectDrag (direction-aware aspect snap for resize drags) ---
{
  const aspect = { min: 1, max: 2 }
  const old = { w: 8, h: 5 }
  const eq = (got, w, h) => got.w === w && got.h === h
  ok(eq(snapAspectDrag(old, { w: 20, h: 5 }, aspect), 20, 10), 'horizontal drag past max derives height from width')
  ok(eq(snapAspectDrag(old, { w: 4, h: 5 }, aspect), 4, 4), 'horizontal drag past min derives height from width')
  ok(eq(snapAspectDrag(old, { w: 9, h: 5 }, aspect), 9, 5), 'horizontal drag inside the band is identity')
  ok(JSON.stringify(snapAspectDrag(old, { w: 8, h: 10 }, aspect)) === JSON.stringify(clampAspect(8, 10, aspect)), 'vertical drag matches clampAspect exactly')
  ok(JSON.stringify(snapAspectDrag(old, { w: 20, h: 6 }, aspect)) === JSON.stringify(clampAspect(20, 6, aspect)), 'corner drag matches clampAspect exactly')
  ok(eq(snapAspectDrag(old, { w: 0, h: 0 }, null), 1, 1), 'no aspect floors degenerate sizes to integer cells')
  const rounded = snapAspectDrag(old, { w: 9.4, h: 5.2 }, aspect)
  ok(Number.isInteger(rounded.w) && Number.isInteger(rounded.h) && rounded.w >= 1 && rounded.h >= 1, 'snapAspectDrag returns integer cells >= 1')
}

// --- stripDerivedTiers (never persist the rebuilt-on-load ultrawide tiers) ---
{
  const src = { lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }], xl: [{ i: 'a', x: 0, y: 0, w: 15, h: 9 }], xxs: [{ i: 'a', x: 0, y: 0, w: 5, h: 9 }] }
  const s = stripDerivedTiers(src)
  ok(Object.keys(s).sort().join() === 'lg,xxs', 'derived tiers are dropped; authoritative ones survive')
  ok(s.lg === src.lg, 'surviving tiers are reused, not copied')
  ok(!!src.xl, 'non-mutating')
  ok(DERIVED_TIERS.every((bp) => COLS[bp] > COLS.lg), 'every derived tier is wider than the base (sanity: the list tracks COLS)')
  ok(Object.keys(stripDerivedTiers(null)).length === 0, 'null input -> empty object (no throw)')
}

// --- boardSignature (the persist no-op guard) ---
{
  const widgets = [{ i: 'b', type: 'calendar' }, { i: 'a', type: 'upcoming', group: 'home' }]
  const lay = { lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 10, y: 0, w: 10, h: 9 }] }
  const sig = boardSignature(widgets, lay)
  // Stability: everything react-grid-layout adds or reorders without a real change.
  ok(boardSignature([...widgets].reverse(), lay) === sig, 'widget order does not change the signature')
  ok(boardSignature(widgets, { lg: [...lay.lg].reverse() }) === sig, 'item order does not change the signature')
  const stamped = { lg: lay.lg.map((it) => ({ ...it, minW: 4, minH: 4, maxW: 20, isResizable: true, moved: false, static: false })) }
  ok(boardSignature(widgets, stamped) === sig, 'stamped constraint/RGL props do not change the signature')
  const withDerived = { ...lay, xl: [{ i: 'a', x: 0, y: 0, w: 15, h: 9 }, { i: 'b', x: 15, y: 0, w: 15, h: 9 }] }
  ok(boardSignature(widgets, withDerived) === sig, 'derived tiers do not change the signature')
  // Sensitivity: every real board change must register.
  ok(boardSignature(widgets, { lg: lay.lg.map((it) => (it.i === 'a' ? { ...it, x: 5 } : it)) }) !== sig, 'a moved widget changes the signature')
  ok(boardSignature(widgets, { lg: lay.lg.map((it) => (it.i === 'a' ? { ...it, w: 12 } : it)) }) !== sig, 'a resized widget changes the signature')
  ok(boardSignature(widgets.slice(1), lay) !== sig, 'a removed widget changes the signature')
  ok(boardSignature(widgets.map((w) => (w.i === 'b' ? { ...w, type: 'notes' } : w)), lay) !== sig, 'a changed widget type changes the signature')
  ok(boardSignature(widgets.map((w) => (w.i === 'a' ? { ...w, group: 'work' } : w)), lay) !== sig, 'a changed widget group changes the signature')
  ok(boardSignature(widgets, { ...lay, md: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 0, y: 9, w: 10, h: 9 }] }) !== sig, 'an added authoritative tier changes the signature')
  ok(boardSignature(widgets.map((w) => (w.i === 'a' ? { ...w, collapsed: true } : w)), lay) !== sig, 'collapsing a widget changes the signature')
}

// --- applyCollapsed / restoreCollapsedHeights (render-time header-only minimize) ---
{
  const lay = { lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 0, y: 9, w: 10, h: 12 }], md: [{ i: 'a', x: 0, y: 0, w: 8, h: 7 }, { i: 'b', x: 0, y: 7, w: 8, h: 10 }] }
  const ids = new Set(['a'])
  const col = applyCollapsed(lay, ids, 2)
  ok(col.lg[0].h === 2 && col.lg[0].minH === 2 && col.lg[0].maxH === 2 && col.lg[0].isResizable === false, 'collapsed item is locked to the header height across props')
  ok(col.md[0].h === 2, 'collapse applies to every breakpoint')
  ok(col.lg[1].h === 12 && col.md[1].h === 10, 'a non-collapsed item is untouched')
  ok(lay.lg[0].h === 9, 'applyCollapsed is non-mutating (source keeps the real height)')
  ok(applyCollapsed(lay, new Set(), 2) === lay, 'no collapsed ids → identity (same reference)')

  // RGL then reports the collapsed height; restore it from the source layouts.
  const rglReport = { lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 2 }, { i: 'b', x: 0, y: 2, w: 10, h: 12 }] }
  const restored = restoreCollapsedHeights(rglReport, lay, ids)
  ok(restored.lg[0].h === 9, 'restore pulls the collapsed item height back from the source (expanded) layout')
  ok(restored.lg[1].h === 12, 'a non-collapsed item keeps the reported height')
  ok(restoreCollapsedHeights(rglReport, lay, new Set()) === rglReport, 'no collapsed ids → identity')
}

console.log(`dashlayout: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
