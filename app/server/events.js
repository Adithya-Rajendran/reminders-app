import crypto from 'node:crypto'

// Connected SSE clients (Express responses kept open).
const clients = new Set()

export function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write(': connected\n\n')
  clients.add(res)
  const keepAlive = setInterval(() => {
    try { res.write(': ka\n\n') } catch { /* ignore */ }
  }, 25000)
  req.on('close', () => {
    clearInterval(keepAlive)
    clients.delete(res)
  })
}

export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try { res.write(payload) } catch { clients.delete(res) }
  }
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
