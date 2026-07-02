// Integration test for the MCP HTTP layer: boots the real express app with the
// real mcpAuth + mcpHandler, seeds a token, and validates every observable
// behaviour without touching CalDAV (tools/call is out of scope here — the e2e
// covers that).  Run with:  node test/mcp_http.test.mjs
import { rmSync } from 'node:fs'
import { createServer } from 'node:http'

// CONFIG_DB_PATH must be set BEFORE importing config.js (better-sqlite3 opens the
// file synchronously at module evaluation time).
process.env.CONFIG_DB_PATH = '/tmp/mcp-http.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const { default: express } = await import('express')
const mcp = await import('../server/mcp.js')
const mcpToken = await import('../server/mcp_token.js')
const config = await import('../server/config.js')

await config.initConfigSchema()

// ---- build a minimal express app ----
const app = express()
app.use(express.json())
// MCP endpoint (bearer-token auth, no session)
app.post('/mcp', mcp.mcpAuth, mcp.mcpHandler)
app.get('/mcp', mcp.mcpMethodNotAllowed)
// Settings management endpoints (session auth — fake it inline)
const fakeSession = (req, _res, next) => { req.session = { user: { sub: 'u-test' } }; next() }
app.put('/api/mcp/settings', fakeSession, mcp.putSettingsHandler)
app.get('/api/mcp/settings', fakeSession, mcp.getSettingsHandler)

// ---- start on a random port (loopback only) ----
const server = createServer(app)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

try {
  // ---- seed ----
  const { token, hash } = mcpToken.generateToken()
  await config.setMcpToken('u-test', hash)
  // Start with only reminders enabled so we can test per-widget gating later.
  await config.setMcpSettings('u-test', { enabled: true, widgets: { reminders: true } })

  // ---- helper ----
  const rpc = (tok, method, params = {}) =>
    fetch(base + '/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })

  // ---------------------------------------------------------------
  // a) tools/list with the token → 200; all names start 'reminders_'; count ≥ 5
  // ---------------------------------------------------------------
  {
    const res = await rpc(token, 'tools/list')
    ok(res.status === 200, 'a: tools/list → 200')
    const body = await res.json()
    const tools = body?.result?.tools ?? []
    ok(tools.length >= 5, `a: tools/list returns ≥ 5 tools (got ${tools.length})`)
    ok(tools.every((t) => t.name.startsWith('reminders_')), 'a: all tool names start with "reminders_"')
  }

  // ---------------------------------------------------------------
  // b) enable daily widget → tools/list grows and includes daily_get_plan
  // ---------------------------------------------------------------
  {
    await config.setMcpSettings('u-test', { enabled: true, widgets: { reminders: true, daily: true } })
    const res = await rpc(token, 'tools/list')
    ok(res.status === 200, 'b: tools/list with daily enabled → 200')
    const body = await res.json()
    const tools = body?.result?.tools ?? []
    ok(tools.some((t) => t.name === 'daily_get_plan'), 'b: tools/list includes daily_get_plan')
    // Restore to reminders-only for subsequent assertions.
    await config.setMcpSettings('u-test', { enabled: true, widgets: { reminders: true } })
  }

  // ---------------------------------------------------------------
  // c) uniform 401 triple: no header / wrong token / valid token with enabled:false
  //    All three: status 401, www-authenticate 'Bearer', body.error.code -32001,
  //    and the three response bodies deep-equal each other.
  // ---------------------------------------------------------------
  {
    const [r1, r2, r3] = await Promise.all([
      rpc(null, 'tools/list'),         // no Authorization header
      rpc('mcp_wrong', 'tools/list'),  // wrong token
      // disable MCP for user then send valid token
      config.setMcpSettings('u-test', { enabled: false, widgets: { reminders: true } })
        .then(() => rpc(token, 'tools/list')),
    ])
    // Restore enabled state before reading r3 body.
    await config.setMcpSettings('u-test', { enabled: true, widgets: { reminders: true } })

    ok(r1.status === 401 && r2.status === 401 && r3.status === 401, 'c: all three return 401')
    ok(
      r1.headers.get('www-authenticate') === 'Bearer' &&
      r2.headers.get('www-authenticate') === 'Bearer' &&
      r3.headers.get('www-authenticate') === 'Bearer',
      'c: all three set WWW-Authenticate: Bearer',
    )
    const [b1, b2, b3] = await Promise.all([r1.json(), r2.json(), r3.json()])
    ok(b1?.error?.code === -32001 && b2?.error?.code === -32001 && b3?.error?.code === -32001,
      'c: all three bodies carry error.code -32001')
    ok(JSON.stringify(b1) === JSON.stringify(b2) && JSON.stringify(b2) === JSON.stringify(b3),
      'c: all three 401 bodies are deep-equal')
  }

  // ---------------------------------------------------------------
  // d) GET /mcp → 405, Allow: POST
  // ---------------------------------------------------------------
  {
    const res = await fetch(base + '/mcp')
    ok(res.status === 405, 'd: GET /mcp → 405')
    ok(res.headers.get('allow') === 'POST', 'd: GET /mcp sets Allow: POST')
  }

  // ---------------------------------------------------------------
  // e) PUT /api/mcp/settings validation (session-auth route)
  //    • unknown widget key → 400
  //    • widgets:[array] → 400
  //    • {enabled:true} then {widgets:{reminders:true}} → partial update, enabled still true
  // ---------------------------------------------------------------
  {
    const put = (body) =>
      fetch(base + '/api/mcp/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const r1 = await put({ widgets: { nope: true } })
    ok(r1.status === 400, 'e: unknown widget key → 400')

    const r2 = await put({ widgets: [] })
    ok(r2.status === 400, 'e: widgets:[] → 400')

    // Set enabled true first, then update only widgets — enabled should survive.
    const r3 = await put({ enabled: true })
    ok(r3.status === 200, 'e: {enabled:true} → 200')
    const b3 = await r3.json()
    ok(b3.enabled === true, 'e: {enabled:true} round-trips correctly')

    const r4 = await put({ widgets: { reminders: true } })
    ok(r4.status === 200, 'e: {widgets:{reminders:true}} → 200')
    const b4 = await r4.json()
    ok(b4.enabled === true, 'e: partial update preserves enabled:true')
    ok(b4.widgets?.reminders === true, 'e: partial update sets reminders:true')
  }

  // ---------------------------------------------------------------
  // f) tools/call for a disabled widget's tool → JSON-RPC error, not a 200 result
  //    notes is a real widget type that is NOT in the enabled set (only reminders is).
  // ---------------------------------------------------------------
  {
    const res = await rpc(token, 'tools/call', { name: 'notes_list', arguments: {} })
    ok(res.status === 200, 'f: tools/call for disabled tool returns 200 HTTP (JSON-RPC error in body)')
    const body = await res.json()
    // The server returns a JSON-RPC error object (MethodNotFound) — no result.
    const hasError = body?.error != null && body?.result == null
    ok(hasError, 'f: tools/call for disabled-widget tool → JSON-RPC error (no result)')
    if (hasError) {
      ok(body.error.code === -32601, `f: error code is -32601 MethodNotFound (got ${body.error.code})`)
    } else {
      fail++ // already counted above
    }
  }
} finally {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
}

console.log(`mcp_http: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
