import { test, expect } from '@playwright/test'
import { listTasks, clearTasks } from '../lib.mjs'

// MCP API contract: auth, tool filtering, tool execution, and error shapes.
// All tests are API-only (request fixture, no browser) — the /mcp endpoint is
// fully exercised at the HTTP level without needing a UI.

// Accept header the MCP spec requires; the server rejects requests that omit it
// (or send only one media type without text/event-stream).
const ACCEPT = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }

// Thin JSON-RPC helper so the test body stays readable.
const rpc = (request, token, method, params, id = 1) =>
  request.post('/mcp', {
    headers: { ...ACCEPT, authorization: `Bearer ${token}` },
    data: { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
  })

test.describe('MCP API', () => {
  let token

  test.beforeEach(async ({ request }) => {
    // Enable MCP with reminders + daily tools; provision a fresh token. The
    // server MERGES widget toggles (deltas, not wholesale replace), so notes is
    // pinned false explicitly — merge semantics would otherwise let a previous
    // test's state leak into this one.
    await request.put('/api/mcp/settings', {
      data: { enabled: true, widgets: { reminders: true, daily: true, notes: false } },
    })
    const r = await request.post('/api/mcp/token')
    expect(r.ok(), `POST /api/mcp/token -> ${r.status()}`).toBeTruthy()
    ;({ token } = await r.json())
    expect(token).toMatch(/^mcp_/)
  })

  test.afterEach(async ({ request }) => {
    // Disable master switch + revoke token + clean tasks so each test starts fresh.
    await request.put('/api/mcp/settings', { data: { enabled: false } })
    await request.delete('/api/mcp/token')
    await clearTasks(request)
  })

  test('initialize + widget-filtered tool list', async ({ request }) => {
    // initialize handshake — every MCP client sends this first.
    const initRes = await rpc(request, token, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '0' },
    })
    expect(initRes.ok(), `initialize -> ${initRes.status()}`).toBeTruthy()
    const init = await initRes.json()
    expect(init.result.serverInfo.name).toBe('reminders-app')

    // With both reminders + daily enabled, the tool list must include both widget
    // families but NOT notes_list (notes widget not enabled for this test).
    const listRes = await rpc(request, token, 'tools/list', undefined)
    expect(listRes.ok()).toBeTruthy()
    const { result: listResult } = await listRes.json()
    const names = listResult.tools.map((t) => t.name)
    expect(names).toContain('reminders_capture')
    expect(names).toContain('daily_get_plan')
    expect(names).not.toContain('notes_list')

    // Turn daily OFF with a single-key delta (the server merges — the old
    // wholesale-replace behavior would have needed the full map here).
    await request.put('/api/mcp/settings', { data: { widgets: { daily: false } } })
    const list2Res = await rpc(request, token, 'tools/list', undefined)
    expect(list2Res.ok()).toBeTruthy()
    const { result: list2Result } = await list2Res.json()
    const names2 = list2Result.tools.map((t) => t.name)
    expect(names2).not.toContain('daily_get_plan')
    // ...and the merge must have preserved the untouched reminders key.
    expect(names2).toContain('reminders_capture')

    // Calling a disabled tool must return a JSON-RPC error (not an HTTP error).
    // The server uses McpError(MethodNotFound) for unknown/disabled tools.
    const callRes = await rpc(request, token, 'tools/call', { name: 'daily_get_plan', arguments: {} })
    expect(callRes.ok()).toBeTruthy() // transport-level 200; error is in the JSON-RPC body
    const callBody = await callRes.json()
    expect(callBody.error, 'disabled tool should return JSON-RPC error').toBeTruthy()
  })

  test('capture creates a real CalDAV task', async ({ request }) => {
    // reminders_capture accepts a natural-language line with the same tokens as
    // the quick-add widget. Verify the task actually lands in CalDAV (not just
    // that the tool said it did).
    const captureRes = await rpc(request, token, 'tools/call', {
      name: 'reminders_capture',
      arguments: { text: 'Buy milk tomorrow !2 *home' },
    })
    expect(captureRes.ok()).toBeTruthy()
    const captureBody = await captureRes.json()
    expect(captureBody.result?.isError, 'capture should not be an in-band error').toBeFalsy()

    // The tool result carries the created task in JSON inside the text content.
    const text = captureBody.result?.content?.[0]?.text
    expect(text, 'result must have content[0].text').toBeTruthy()
    const parsed = JSON.parse(text)
    expect(parsed.task, 'result must include a task object').toBeTruthy()

    // Poll until the task propagates from CalDAV back through the read path.
    await expect.poll(async () => {
      const tasks = await listTasks(request)
      return tasks.find((t) => t.title === 'Buy milk')
    }, { timeout: 15000 }).toBeTruthy()

    const tasks = await listTasks(request)
    const task = tasks.find((t) => t.title === 'Buy milk')
    expect(task.priority).toBe(2)
    expect((task.labels || []).some((l) => l.title === 'home')).toBe(true)
    // "tomorrow" must produce a real date, not the ZERO_DATE sentinel.
    expect(task.due_date).not.toBe('0001-01-01T00:00:00Z')
  })

  test('uniform 401 + 405', async ({ request }) => {
    // Three distinct auth failure modes must return an IDENTICAL response body.
    // This is intentional: probing must not reveal whether MCP is disabled or
    // whether a token exists.

    // Case A: valid token but master switch is off.
    await request.put('/api/mcp/settings', { data: { enabled: false } })
    const resOff = await request.post('/mcp', {
      headers: { ...ACCEPT, authorization: `Bearer ${token}` },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })

    // Case B: garbage token (well-formed bearer, but unknown hash).
    const resGarbage = await request.post('/mcp', {
      headers: { ...ACCEPT, authorization: 'Bearer mcp_bogus' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })

    // Case C: no Authorization header at all.
    const resNoAuth = await request.post('/mcp', {
      headers: ACCEPT,
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })

    // Read each body as text first (Playwright's response body can only be
    // consumed once — parse manually so we can check both fields AND identity).
    const entries = [
      ['switch-off', resOff],
      ['garbage-token', resGarbage],
      ['no-auth', resNoAuth],
    ]
    const jsons = []
    for (const [label, res] of entries) {
      expect(res.status(), `${label} status`).toBe(401)
      expect(res.headers()['www-authenticate'], `${label} WWW-Authenticate`).toBe('Bearer')
      const body = JSON.parse(await res.text())
      expect(body.error?.code, `${label} error.code`).toBe(-32001)
      jsons.push(body)
    }

    // All three bodies must carry the identical error message.
    expect(jsons[0].error.message).toBe(jsons[1].error.message)
    expect(jsons[1].error.message).toBe(jsons[2].error.message)

    // GET /mcp must be 405 with Allow: POST.
    const getRes = await request.get('/mcp')
    expect(getRes.status()).toBe(405)
    expect(getRes.headers()['allow']).toContain('POST')

    // Restore the master switch for afterEach cleanup.
    await request.put('/api/mcp/settings', { data: { enabled: true } })
  })

  test('406 without dual accept', async ({ request }) => {
    // /mcp demands BOTH application/json and text/event-stream in Accept because
    // the client might receive either (stateless JSON or SSE stream).
    // A request with only application/json must be rejected with 406.
    const res = await request.post('/mcp', {
      headers: {
        'content-type': 'application/json',
        accept: 'application/json', // missing text/event-stream
        authorization: `Bearer ${token}`,
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(res.status()).toBe(406)
  })
})
