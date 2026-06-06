import crypto from 'node:crypto'

// SSE clients grouped by user (OIDC sub) so a reminder reaches ONLY its owner.
// (The previous global Set broadcast every event to every connected user.)
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

// Fan out to everyone — retained only for the legacy Vikunja webhook path during
// the soak/rollback window; removed at Vikunja retirement.
export function broadcast(event, data) {
  for (const set of userClients.values()) for (const res of set) writeSse(res, event, data)
}

// Vikunja calls this with an HMAC-SHA256 signature over the raw body.
export function handleWebhook(req, res) {
  const secret = process.env.WEBHOOK_SECRET
  // Fail closed: never accept unsigned webhooks on this public, unauthenticated route.
  if (!secret) {
    console.error('webhook: WEBHOOK_SECRET not configured — rejecting')
    return res.status(503).end()
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '')
  const provided = req.get('x-vikunja-signature') || ''
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn('webhook: invalid signature')
    return res.status(401).end()
  }
  let evt = {}
  try { evt = JSON.parse(raw.toString('utf8')) } catch { /* keep empty */ }
  broadcast('vikunja', { receivedAt: Date.now(), event: evt })
  res.status(200).json({ ok: true })
}
