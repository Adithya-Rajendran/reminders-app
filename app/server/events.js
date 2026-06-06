// SSE clients grouped by user (OIDC sub) so a reminder reaches ONLY its owner.
const userClients = new Map() // sub -> Set<res>

function writeSse(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch { /* dropped; cleaned on close */ }
}

export function sseHandler(req, res) {
  const sub = req.session.user.sub
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write(': connected\n\n')
  let set = userClients.get(sub)
  if (!set) { set = new Set(); userClients.set(sub, set) }
  set.add(res)
  const keepAlive = setInterval(() => { try { res.write(': ka\n\n') } catch { /* ignore */ } }, 25000)
  req.on('close', () => {
    clearInterval(keepAlive)
    set.delete(res)
    if (set.size === 0) userClients.delete(sub)
  })
}

// Deliver only to the owning user's connections — the per-user reminder path.
export function sendToUser(userId, event, data) {
  const set = userClients.get(userId)
  if (!set) return
  for (const res of set) writeSse(res, event, data)
}
