// Reverse-proxy to the Vikunja REST API using a service account.
// The browser never sees a Vikunja credential; all task data flows through here.
const BASE = process.env.VIKUNJA_URL || 'http://vikunja:3456'

let jwt = null
let jwtExpMs = 0

function decodeExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
    return (payload.exp || 0) * 1000
  } catch { return 0 }
}

async function login() {
  const r = await fetch(BASE + '/api/v1/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.VIKUNJA_USERNAME,
      password: process.env.VIKUNJA_PASSWORD,
      long_token: true,
    }),
  })
  if (!r.ok) throw new Error('vikunja login failed: ' + r.status + ' ' + (await r.text()))
  const j = await r.json()
  jwt = j.token
  jwtExpMs = decodeExp(jwt)
  return jwt
}

let pendingLogin = null
async function getToken() {
  if (process.env.VIKUNJA_TOKEN) return process.env.VIKUNJA_TOKEN
  if (jwt && Date.now() < jwtExpMs - 30000) return jwt
  // Coalesce concurrent refreshes so we don't stampede Vikunja's /login.
  if (!pendingLogin) pendingLogin = login().finally(() => { pendingLogin = null })
  return pendingLogin
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer',
  'upgrade', 'content-length', 'content-encoding',
])

export async function proxyVikunja(req, res) {
  const target = BASE + req.originalUrl.replace(/^\/api\/vikunja/, '/api/v1')
  const send = async (tok) => {
    const headers = { Authorization: 'Bearer ' + tok }
    let body
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(req.body)
    }
    return fetch(target, { method: req.method, headers, body })
  }
  try {
    let r = await send(await getToken())
    if (r.status === 401 && !process.env.VIKUNJA_TOKEN) {
      await login()
      r = await send(jwt)
    }
    // A still-401 means the SERVICE account itself failed; do NOT forward 401 to
    // the browser (the SPA treats 401 as user-session expiry and would loop on login).
    if (r.status === 401 && !process.env.VIKUNJA_TOKEN) {
      console.error('vikunja service-account auth failed — check VIKUNJA_USERNAME/PASSWORD')
      return res.status(502).json({ error: 'upstream auth error' })
    }
    res.status(r.status)
    for (const [k, v] of r.headers) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) res.set(k, v)
    }
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    console.error('vikunja proxy error:', e)
    res.status(502).json({ error: 'upstream error' })
  }
}
