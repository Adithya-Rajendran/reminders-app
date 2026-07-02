// The embedded MCP server: /mcp (Streamable HTTP, bearer-token auth) exposing
// the per-widget toolsets from mcp_tools.js, plus the session-authenticated
// /api/mcp/* management endpoints Settings uses (enable/disable, per-widget
// toggles, token lifecycle).
//
// Transport is STATELESS (a fresh Server + transport per POST, no MCP session
// ids): tools are the only capability, so there's nothing to keep between
// requests, and enableJsonResponse keeps every response plain application/json —
// no SSE, so the compression middleware never buffers a stream. The request
// body arrives already parsed by express.json; handleRequest accepts it as the
// third argument.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { MCP_WIDGET_TYPES, toolsForWidgets } from './mcp_tools.js'
import { generateToken, hashToken, hashesEqual } from './mcp_token.js'
import { validateInput } from './mcp_validate.js'
import {
  getMcpToken, getMcpTokenByHash, setMcpToken, deleteMcpToken, touchMcpToken,
  getMcpSettings, setMcpSettings,
} from './config.js'

// One 401 shape for every failure mode (missing/malformed/unknown token, master
// switch off) — deliberately indistinguishable, so probing can't learn whether a
// token exists or MCP is merely disabled. JSON-RPC-shaped body per MCP HTTP auth
// conventions.
function unauthorized(res) {
  res.status(401).set('WWW-Authenticate', 'Bearer')
    .json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null })
}

// last_used_at is informational (Settings shows it) — throttle the write to at
// most one per user per minute so busy clients don't hammer SQLite.
const lastTouch = new Map()

export async function mcpAuth(req, res, next) {
  try {
    const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')
    if (!m) return unauthorized(res)
    const hash = hashToken(m[1].trim())
    const row = await getMcpTokenByHash(hash) // UNIQUE-indexed O(1) lookup
    // timingSafeEqual is defense in depth on top of the indexed lookup (the
    // 256-bit random token already defeats guessing).
    if (!row || !hashesEqual(row.token_hash, hash)) return unauthorized(res)
    const settings = await getMcpSettings(row.user_id)
    if (!settings.enabled) return unauthorized(res)
    req.mcpUser = { sub: row.user_id }
    req.mcpWidgets = new Set(MCP_WIDGET_TYPES.filter((t) => settings.widgets[t] === true))
    const now = Date.now()
    if ((lastTouch.get(row.user_id) || 0) < now - 60_000) {
      lastTouch.set(row.user_id, now)
      touchMcpToken(row.user_id).catch(() => {})
    }
    next()
  } catch (e) { next(e) }
}

// A per-request Server closing over the user's ENABLED toolset: a disabled
// widget's tools are neither listed nor callable. Construction is closures over
// the static registry — sub-millisecond, fine per request.
function buildServer(sub, enabledSet) {
  const server = new Server({ name: 'reminders-app', version: '1.0.0' }, { capabilities: { tools: {} } })
  const tools = toolsForWidgets(enabledSet)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name)
    if (!tool) throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${request.params.name}`)
    const v = validateInput(tool.inputSchema, request.params.arguments)
    if (!v.ok) return { isError: true, content: [{ type: 'text', text: 'invalid arguments: ' + v.error }] }
    try {
      const result = await tool.handler({ sub }, v.value)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (e) {
      // Tool failures go IN-BAND (isError) so the model can react. 4xx messages
      // are user-facing by contract (the cores throw sanitized text); 5xx are
      // genericized. Log status only — never headers, tokens, or upstream bodies.
      const status = e?.status || 500
      if (status >= 500) console.error(`mcp tool ${tool.name} failed (HTTP ${status})`)
      const text = status < 500 && e?.message ? e.message : 'upstream error — try again'
      return { isError: true, content: [{ type: 'text', text }] }
    }
  })
  return server
}

export async function mcpHandler(req, res, next) {
  try {
    const server = buildServer(req.mcpUser.sub, req.mcpWidgets)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,      // plain JSON responses (no SSE)
    })
    res.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (e) { next(e) }
}

// Stateless mode has no GET event stream and no session to DELETE.
export function mcpMethodNotAllowed(req, res) {
  res.status(405).set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed — POST JSON-RPC to this endpoint' }, id: null })
}

// ---- Settings-facing management API (session auth, mounted under /api/mcp) ----

async function settingsPayload(sub) {
  const s = await getMcpSettings(sub)
  const tok = await getMcpToken(sub)
  return {
    enabled: s.enabled,
    widgets: s.widgets,
    hasToken: !!tok,
    tokenCreatedAt: tok?.created_at || null,
    lastUsedAt: tok?.last_used_at || null,
  }
}

export async function getSettingsHandler(req, res, next) {
  try { res.json(await settingsPayload(req.session.user.sub)) } catch (e) { next(e) }
}

export async function putSettingsHandler(req, res, next) {
  try {
    const sub = req.session.user.sub
    const cur = await getMcpSettings(sub)
    const b = req.body || {}
    const enabled = b.enabled === undefined ? cur.enabled : !!b.enabled
    let widgets = cur.widgets
    if (b.widgets !== undefined) {
      if (!b.widgets || typeof b.widgets !== 'object' || Array.isArray(b.widgets)) {
        return res.status(400).json({ error: 'widgets must be an object of { widgetType: boolean }' })
      }
      widgets = {}
      for (const [k, v] of Object.entries(b.widgets)) {
        if (!MCP_WIDGET_TYPES.includes(k)) return res.status(400).json({ error: `unknown widget type: ${k}` })
        widgets[k] = !!v
      }
    }
    await setMcpSettings(sub, { enabled, widgets })
    res.json(await settingsPayload(sub))
  } catch (e) { next(e) }
}

export async function createTokenHandler(req, res, next) {
  try {
    const { token, hash } = generateToken()
    await setMcpToken(req.session.user.sub, hash) // replaces any prior token
    res.json({ token }) // the ONLY time the plaintext exists — never stored, never logged
  } catch (e) { next(e) }
}

export async function deleteTokenHandler(req, res, next) {
  try { await deleteMcpToken(req.session.user.sub); res.json({ ok: true }) } catch (e) { next(e) }
}
