// Pure dashboard grid math: scaleLayouts (old-grid upgrades), defaultLayouts
// (fresh-board placement), appendToLayouts (add-widget placement). Run with:
//   node test/dashlayout.test.mjs
import {
  COLS, GRID_V, SCALE_TO_CURRENT, DEFAULT_SIZE,
  scaleLayouts, defaultLayouts, appendToLayouts,
} from '../client/src/dashlayout.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- invariants the persistence format depends on ---
ok(GRID_V === 3, 'GRID_V is 3 (bump SCALE_TO_CURRENT when changing the grid)')
ok(Object.keys(SCALE_TO_CURRENT).length === GRID_V, 'every historical gridV has a scale factor')
ok(SCALE_TO_CURRENT[GRID_V] === 1, 'the current gridV scales by 1 (no-op)')
for (const [v, f] of Object.entries(SCALE_TO_CURRENT)) {
  ok(COLS.lg === Math.round(COLS.lg / f) * f, `gridV ${v}: lg col count survives a round-trip through factor ${f}`)
}

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
