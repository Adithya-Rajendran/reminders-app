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

// Vikunja's `POST /tasks/{id}` is a FULL-OBJECT write: any column omitted from
// the request body is reset to its zero value (priority 0, due_date cleared,
// reminders dropped, …). The SPA sends single-field patches — complete
// (`{done:true}`), inline priority/due edits, calendar drag (`{due_date}`) — so
// without intervention each of those silently wipes the task's other fields.
// Matching exactly /tasks/{numericId} lets us turn those into read-modify-write.
const TASK_UPDATE_RE = /^\/api\/vikunja\/tasks\/\d+$/

export async function proxyVikunja(req, res) {
  const reqPath = req.originalUrl.split('?')[0]
  const target = BASE + req.originalUrl.replace(/^\/api\/vikunja/, '/api/v1')
  const isTaskUpdate = req.method === 'POST' && TASK_UPDATE_RE.test(reqPath) &&
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)

  const send = async (tok) => {
    let payload = req.body
    // Read-modify-write: merge the patch over the task's current full state so
    // omitted fields are preserved instead of zeroed. Makes every client safe.
    if (isTaskUpdate) {
      const cur = await fetch(target, { headers: { Authorization: 'Bearer ' + tok } })
      if (cur.ok) {
        const current = await cur.json().catch(() => null)
        if (current && typeof current === 'object' && !Array.isArray(current)) payload = { ...current, ...req.body }
      }
    }
    const headers = { Authorization: 'Bearer ' + tok }
    let body
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method) && payload && Object.keys(payload).length) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(payload)
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
