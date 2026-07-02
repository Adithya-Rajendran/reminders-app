// The Cues flow-board geometry (client/src/flowgeom.js): pointer→content
// transform, node/edge anchor math, edge-path string, drop/drag clamping, and the
// data-uid hit-test walk. Pure — no renderer needed.
// Run with: node test/flowgeom.test.mjs
import {
  NODE_W, NODE_H, CONTENT_W, CONTENT_H,
  edgePath, toContent, nodeOut, nodeIn, edgeBetween, dropBase, dragTo, uidFromPoint,
} from '../client/src/flowgeom.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`)

// --- constants are the sizing contract the widget + tests share ---
ok(NODE_W === 188 && NODE_H === 64, 'node is 188×64')
ok(CONTENT_W === 2400 && CONTENT_H === 1400, 'content plane is 2400×1400')

// --- edgePath: cubic bezier with ±55 horizontal control offsets ---
eq(edgePath(0, 0, 100, 40), 'M 0 0 C 55 0, 45 40, 100 40', 'edgePath builds the S-curve string')

// --- toContent: client coords minus the canvas rect, plus its scroll (pan) ---
{
  const rect = { left: 20, top: 10 }
  const p = toContent(rect, 0, 0, 120, 60)
  ok(p.x === 100 && p.y === 50, 'unscrolled: subtracts the canvas top-left')
  const panned = toContent(rect, 300, 150, 120, 60)
  ok(panned.x === 400 && panned.y === 200, 'scrolled: adds scrollLeft/scrollTop (pan)')
}

// --- node anchors: right-edge midpoint out, left-edge midpoint in ---
{
  const pos = { x: 10, y: 20 }
  const out = nodeOut(pos)
  ok(out.x === 10 + NODE_W && out.y === 20 + NODE_H / 2, 'nodeOut is the right-edge midpoint')
  const inn = nodeIn(pos)
  ok(inn.x === 10 && inn.y === 20 + NODE_H / 2, 'nodeIn is the left-edge midpoint')
}

// --- edgeBetween: source right-edge → target left-edge, via edgePath ---
{
  const d = edgeBetween({ x: 10, y: 20 }, { x: 300, y: 100 })
  const expected = edgePath(10 + NODE_W, 20 + NODE_H / 2, 300, 100 + NODE_H / 2)
  eq(d, expected, 'edgeBetween connects the anchors of two placed nodes')
}

// --- dropBase: center under pointer, nudge up, clamp to top/left edge ---
{
  const b = dropBase({ x: 500, y: 300 })
  ok(b.x === 500 - NODE_W / 2 && b.y === 300 - 20, 'dropBase centers horizontally and lifts by 20')
  const clamped = dropBase({ x: 10, y: 5 })
  ok(clamped.x === 0 && clamped.y === 0, 'dropBase never goes off the top/left edge')
}

// --- dragTo: pointer minus grab offset, clamped ---
{
  const t = dragTo({ x: 400, y: 200 }, 90, 30)
  ok(t.x === 310 && t.y === 170, 'dragTo subtracts the grab offset')
  const clamped = dragTo({ x: 50, y: 20 }, 90, 30)
  ok(clamped.x === 0 && clamped.y === 0, 'dragTo clamps to the top/left edge')
}

// --- uidFromPoint: walk up to the nearest [data-uid], stopping at <body> ---
{
  // Minimal DOM stand-ins: uidFromPoint only reads el.dataset.uid, el.parentElement,
  // and compares against document.body — no jsdom needed.
  const body = { dataset: {}, parentElement: null }
  globalThis.document = { body }
  const node = { dataset: { uid: 'u7' }, parentElement: body }
  const child = { dataset: {}, parentElement: node }
  eq(uidFromPoint(child), 'u7', 'walks up from an inner element to the [data-uid] card')
  eq(uidFromPoint(node), 'u7', 'returns the uid when handed the card itself')
  eq(uidFromPoint(body), null, 'stops at <body> (a miss returns null)')
  eq(uidFromPoint(null), null, 'a null hit (nothing under the pointer) returns null')
  delete globalThis.document
}

console.log(`flowgeom: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
