// Pure dashboard grid math: scaleLayouts (old-grid upgrades), defaultLayouts
// (fresh-board placement), appendToLayouts (add-widget placement). Run with:
//   node test/dashlayout.test.mjs
import {
  COLS, BREAKPOINTS, GRID_V, SCALE_TO_CURRENT, DEFAULT_SIZE,
  scaleLayouts, defaultLayouts, appendToLayouts, fillBreakpoints, repack,
} from '../client/src/dashlayout.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- invariants the persistence format depends on ---
ok(GRID_V === 4, 'GRID_V is 4 (bump SCALE_TO_CURRENT when changing the grid)')
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

// --- fillBreakpoints (constant-size repack into the wider tiers) ---
const partial = { lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 20, y: 0, w: 10, h: 9 }] }
const filled = fillBreakpoints(partial)
ok(Object.keys(filled).sort().join() === Object.keys(COLS).sort().join(), 'fills every missing breakpoint from the densest present one')
ok(partial.lg.length === 2 && partial.lg[1].x === 20 && !partial.xxxxl, 'fillBreakpoints is non-mutating')
ok(filled.lg === partial.lg, 'present breakpoints are reused untouched')
// Widgets keep their size on a wider tier (no proportional growth)...
ok(filled.xxxxl.every((it) => it.w === 10 && it.h === 9), 'widget size (w/h) is unchanged on a wider tier')
// ...and the extra columns just fit more per row: two 10-wide widgets share row 0.
ok(filled.xxxxl[0].y === 0 && filled.xxxxl[1].y === 0 && filled.xxxxl.map((it) => it.x).sort((a, b) => a - b).join() === '0,10', 'widgets repack left-to-right into the wider tier')
ok(filled.xs.every((it) => it.x + it.w <= COLS.xs && it.w >= 2), 'repacked items stay within the target column range')
// A widget on a lower row moves up when the wider tier has room beside the first.
const stacked = fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 0, y: 9, w: 10, h: 9 }] })
ok(stacked.xxxxl.find((it) => it.i === 'b').y === 0, 'a lower widget moves up into the freed horizontal space')
// Wrapping: at md (25 cols) two 10-wide widgets fit a shelf, the third wraps below.
const wrapped = fillBreakpoints({ lg: [{ i: 'a', x: 0, y: 0, w: 10, h: 9 }, { i: 'b', x: 10, y: 0, w: 10, h: 9 }, { i: 'c', x: 20, y: 0, w: 10, h: 9 }] }).md
ok(wrapped.filter((it) => it.y === 0).length === 2 && wrapped.find((it) => it.i === 'c').x === 0 && wrapped.find((it) => it.i === 'c').y === 9, 'a third widget wraps to a new shelf below (shelf height = max h)')
// repack is idempotent (so onLayoutChange echoes don't drift) and array-safe.
ok(JSON.stringify(repack(repack(partial.lg, 64), 64)) === JSON.stringify(repack(partial.lg, 64)), 'repack is idempotent')
ok(repack([], 30).length === 0 && repack(null, 30).length === 0, 'repack handles empty/null input')
const allThere = defaultLayouts([{ i: 'w-1', type: 'a' }], () => ({ ...DEFAULT_SIZE }))
ok(fillBreakpoints(allThere) !== allThere && Object.keys(fillBreakpoints(allThere)).length === Object.keys(allThere).length, 'a fully-populated layout gains no breakpoints (returns a copy)')
ok(Object.keys(fillBreakpoints(null)).length === 0 && Object.keys(fillBreakpoints({})).length === 0, 'null/empty input -> empty object (no throw)')

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

console.log(`dashlayout: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
