// Integration test for the PUT /api/mcp/settings MERGE semantics introduced to
// fix the widget-state-loss bug: a PUT that names only a subset of widget keys
// must not clobber keys it didn't mention (server merges into current state
// rather than wholesale-replacing).
//
// Also covers: unknown widget type → 400; widgets:[] → 400; enabled flag
// survives a widgets-only PUT; widgets survive an enabled-only PUT.
//
// Run with: node test/mcp_settings_merge.test.mjs
import { rmSync } from 'node:fs'
import { createServer } from 'node:http'

// CONFIG_DB_PATH must be set BEFORE importing config.js (better-sqlite3 opens
// the file synchronously at module evaluation time).
process.env.CONFIG_DB_PATH = '/tmp/mcp-settings-merge.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const { default: express } = await import('express')
const mcp = await import('../server/mcp.js')
const config = await import('../server/config.js')

await config.initConfigSchema()

// ---- build a minimal express app (settings endpoints only) ----
const app = express()
app.use(express.json())
const fakeSession = (req, _res, next) => { req.session = { user: { sub: 'u-merge' } }; next() }
app.put('/api/mcp/settings', fakeSession, mcp.putSettingsHandler)
app.get('/api/mcp/settings', fakeSession, mcp.getSettingsHandler)

// ---- start on a random port (loopback only) ----
const server = createServer(app)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.error('  ✗ ' + m) } }

const put = (body) =>
  fetch(base + '/api/mcp/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const get = () =>
  fetch(base + '/api/mcp/settings').then((r) => r.json())

try {
  // ---------------------------------------------------------------
  // Seed: start with reminders:true, enabled:true
  // ---------------------------------------------------------------
  await config.setMcpSettings('u-merge', { enabled: true, widgets: { reminders: true } })

  // ---------------------------------------------------------------
  // a) PUT {widgets:{daily:true}} — must NOT clobber reminders
  // ---------------------------------------------------------------
  {
    const r = await put({ widgets: { daily: true } })
    ok(r.status === 200, 'a: PUT {widgets:{daily:true}} → 200')
    const b = await r.json()
    ok(b.widgets?.reminders === true, 'a: reminders still true after delta PUT for daily')
    ok(b.widgets?.daily === true, 'a: daily now true')
  }

  // ---------------------------------------------------------------
  // b) PUT {enabled:false} — widgets must survive an enabled-only PUT
  // ---------------------------------------------------------------
  {
    const r = await put({ enabled: false })
    ok(r.status === 200, 'b: PUT {enabled:false} → 200')
    const b = await r.json()
    ok(b.enabled === false, 'b: enabled is now false')
    ok(b.widgets?.reminders === true, 'b: reminders survived enabled-only PUT')
    ok(b.widgets?.daily === true, 'b: daily survived enabled-only PUT')
  }

  // ---------------------------------------------------------------
  // c) PUT {widgets:{daily:true}} — enabled:false must survive a widgets-only PUT
  // ---------------------------------------------------------------
  {
    const r = await put({ widgets: { daily: true } })
    ok(r.status === 200, 'c: PUT {widgets:{daily:true}} after enabled:false → 200')
    const b = await r.json()
    ok(b.enabled === false, 'c: enabled still false after widgets-only PUT')
    ok(b.widgets?.reminders === true, 'c: reminders still true')
    ok(b.widgets?.daily === true, 'c: daily still true')
  }

  // ---------------------------------------------------------------
  // d) Sequence: PUT reminders:true → PUT enabled:false → PUT daily:true
  //    Final: reminders STILL true, enabled STILL false
  // ---------------------------------------------------------------
  {
    // Reset
    await config.setMcpSettings('u-merge', { enabled: true, widgets: { reminders: true } })

    await put({ widgets: { reminders: true } })
    await put({ enabled: false })
    const r = await put({ widgets: { daily: true } })
    ok(r.status === 200, 'd: final PUT in sequence → 200')
    const b = await r.json()
    ok(b.widgets?.reminders === true, 'd: reminders still true at end of sequence')
    ok(b.enabled === false, 'd: enabled still false at end of sequence')
    ok(b.widgets?.daily === true, 'd: daily true at end of sequence')
  }

  // ---------------------------------------------------------------
  // e) Unknown widget type → 400
  // ---------------------------------------------------------------
  {
    const r = await put({ widgets: { nope: true } })
    ok(r.status === 400, 'e: unknown widget type → 400')
    const b = await r.json()
    ok(typeof b.error === 'string' && b.error.includes('unknown widget type'), 'e: error message mentions unknown widget type')
  }

  // ---------------------------------------------------------------
  // f) widgets:[] (array, not object) → 400
  // ---------------------------------------------------------------
  {
    const r = await put({ widgets: [] })
    ok(r.status === 400, 'f: widgets:[] → 400')
    const b = await r.json()
    ok(typeof b.error === 'string', 'f: error body is a string')
  }

  // ---------------------------------------------------------------
  // g) GET reflects the final persisted state accurately
  // ---------------------------------------------------------------
  {
    // Reset to a known state then verify GET matches.
    await config.setMcpSettings('u-merge', { enabled: true, widgets: { reminders: true, daily: false } })
    await put({ widgets: { daily: true } })
    const b = await get()
    ok(b.widgets?.reminders === true, 'g: GET reminders still true')
    ok(b.widgets?.daily === true, 'g: GET daily true after delta PUT')
    ok(b.enabled === true, 'g: GET enabled still true')
  }
} finally {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
}

console.log(`mcp_settings_merge: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
