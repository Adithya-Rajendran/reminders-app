// Pure ordering for palette COMMAND results (fuzzy.js stays generic). Commands
// may carry `priority` (higher = earlier; default 0): on an empty query the
// list is stable-sorted by priority so workflow actions (capture, go-to) lead
// and destructive/rare ones (logout) sink; with a query the fuzzy score still
// dominates and priority only nudges ties. Node-tested (test/palettecmds.test.mjs).
export function orderCommands(results, term) {
  const pri = (r) => r.item?.priority || 0
  const list = [...results]
  if (!String(term || '').trim()) {
    // Stable: equal priorities keep their registration order.
    return list.map((r, i) => [r, i]).sort((a, b) => (pri(b[0]) - pri(a[0])) || (a[1] - b[1])).map(([r]) => r)
  }
  return list.sort((a, b) => (b.score + pri(b) * 0.5) - (a.score + pri(a) * 0.5))
}
