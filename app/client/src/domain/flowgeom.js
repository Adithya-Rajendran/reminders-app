// Pure geometry for the Cues flow board (CuesWidget). Kept renderer-free so the
// node tests can pin the pointer→content coordinate transform, the node/edge
// anchor math, and the SVG edge-path string without a DOM or React. The widget
// imports these via the widget-sdk barrel; the only DOM-touching helper here is
// uidFromPoint, which walks a hit element up to its [data-uid] ancestor.

// Board geometry. A node is a fixed-size card; the content plane is a large
// fixed canvas the cards are positioned within (the widget scrolls/pans it).
export const NODE_W = 188
export const NODE_H = 64
export const CONTENT_W = 2400
export const CONTENT_H = 1400

// Cubic bezier from a node's right-edge anchor to the target's left-edge anchor.
// The ±55 horizontal control offset gives the S-curve its flat entry/exit so the
// arrowhead meets the target head-on regardless of vertical offset.
export const edgePath = (sx, sy, tx, ty) => `M ${sx} ${sy} C ${sx + 55} ${sy}, ${tx - 55} ${ty}, ${tx} ${ty}`

// Pointer client coords -> content-plane coords, accounting for the canvas's
// on-screen position (rect) and how far it's scrolled (pan). Pure: the widget
// reads rect/scroll off the live canvas element and passes them in.
export function toContent(rect, scrollLeft, scrollTop, clientX, clientY) {
  return { x: clientX - rect.left + scrollLeft, y: clientY - rect.top + scrollTop }
}

// The right-edge midpoint of a node — where an outgoing link starts and where an
// incoming edge's source anchor sits.
export function nodeOut(pos) {
  return { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 }
}

// The left-edge midpoint of a node — where an incoming edge terminates.
export function nodeIn(pos) {
  return { x: pos.x, y: pos.y + NODE_H / 2 }
}

// The edge path connecting two placed nodes, right-edge of source to left-edge of
// target.
export function edgeBetween(sourcePos, targetPos) {
  const s = nodeOut(sourcePos)
  const t = nodeIn(targetPos)
  return edgePath(s.x, s.y, t.x, t.y)
}

// Where a card lands when first dropped onto the board from the queue: centered
// horizontally under the pointer and offset up a little so the pointer grabs the
// title row, clamped to the canvas bounds. canvasW and canvasH default to the
// constants for backward compatibility.
export function dropBase(contentPt, canvasW = CONTENT_W, canvasH = CONTENT_H) {
  const x = contentPt.x - NODE_W / 2
  const y = contentPt.y - 20
  return {
    x: Math.max(0, Math.min(x, canvasW - NODE_W)),
    y: Math.max(0, Math.min(y, canvasH - NODE_H))
  }
}

// New top-left for a node being dragged: the current pointer content position
// minus the grab offset, clamped to the canvas bounds. canvasW and canvasH default
// to the constants for backward compatibility.
export function dragTo(contentPt, offX, offY, canvasW = CONTENT_W, canvasH = CONTENT_H) {
  const x = contentPt.x - offX
  const y = contentPt.y - offY
  return {
    x: Math.max(0, Math.min(x, canvasW - NODE_W)),
    y: Math.max(0, Math.min(y, canvasH - NODE_H))
  }
}

// How big the content plane effectively is. The constants are only a floor:
// the plane grows with the measured widget (a bigger widget deserves more
// board) and never shrinks below the placed nodes' extents — otherwise
// shrinking the widget after parking a card far right/down would strand that
// card beyond the scrollable area, unreachable and invisible.
const VIEW_SCALE = 2.2
const EXTENT_MARGIN = 40
export function canvasExtent(nodes, floorW = CONTENT_W, floorH = CONTENT_H, viewW = 0, viewH = 0) {
  let maxX = 0, maxY = 0
  for (const n of nodes || []) {
    if (!n) continue // unplaced tasks carry a null flow — skip them
    if (n.x > maxX) maxX = n.x
    if (n.y > maxY) maxY = n.y
  }
  return {
    w: Math.max(floorW, (viewW || 0) * VIEW_SCALE, maxX + NODE_W + EXTENT_MARGIN),
    h: Math.max(floorH, (viewH || 0) * VIEW_SCALE, maxY + NODE_H + EXTENT_MARGIN),
  }
}

// Walk a hit element up to the nearest ancestor carrying a data-uid, returning
// that uid (or null). Mirrors the drag-drop hit test: which card, if any, is
// under the release point.
export function uidFromPoint(el) {
  while (el && el !== document.body) {
    if (el.dataset && el.dataset.uid) return el.dataset.uid
    el = el.parentElement
  }
  return null
}
