// The manifest ↔ MCP-tool-registry contract: every tool a widget DECLARES
// (manifest.js `mcp.tools`) is IMPLEMENTED exactly once in server/mcp_tools.js
// and vice versa — same spirit as the registry-renderer and LOADERS parity
// tests, so the Settings toggles, the /mcp filter, and the implementations can
// never drift apart. Also validates each tool's shape (name, description,
// input schema well-formedness). Run with: node test/mcp_contract.test.mjs
import { rmSync } from 'node:fs'

// mcp_tools.js imports tasks_caldav.js -> config.js, which exits without a DB
// path — point it at a throwaway file before importing (config.sqlite pattern).
process.env.CONFIG_DB_PATH = process.env.MCP_CONTRACT_TEST_DB || '/tmp/mcp-contract.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const { MCP_TOOLS, TOOLS_BY_NAME, MCP_WIDGET_TYPES, toolsForWidgets } = await import('../server/mcp_tools.js')
const { WIDGET_MANIFEST } = await import('../client/src/widgets/manifest.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- manifest ↔ registry parity ---
const declared = new Map() // tool name -> widget type
for (const m of WIDGET_MANIFEST) {
  if (!m.mcp) continue
  for (const name of m.mcp.tools) {
    ok(!declared.has(name), `${name}: declared by only one widget (also in ${declared.get(name) || ''})`)
    declared.set(name, m.type)
  }
}
ok(declared.size > 0, 'at least one widget declares MCP tools')
for (const [name, widget] of declared) {
  const impl = TOOLS_BY_NAME.get(name)
  ok(!!impl, `${name}: declared in the manifest is implemented in mcp_tools.js`)
  if (impl) ok(impl.widget === widget, `${name}: implementation is grouped under its declaring widget (${impl.widget} vs ${widget})`)
}
for (const t of MCP_TOOLS) {
  ok(declared.get(t.name) === t.widget, `${t.name}: implemented tool is declared by its widget's manifest mcp.tools`)
}
ok(MCP_TOOLS.length === declared.size, `registry size matches declarations (${MCP_TOOLS.length} vs ${declared.size})`)
ok(new Set(MCP_TOOLS.map((t) => t.name)).size === MCP_TOOLS.length, 'implemented tool names are globally unique')

// --- naming: snake_case, prefixed with the owning widget type ---
for (const t of MCP_TOOLS) {
  ok(/^[a-z][a-z0-9_]*$/.test(t.name), `${t.name}: snake_case`)
  ok(t.name.startsWith(t.widget + '_'), `${t.name}: starts with '${t.widget}_'`)
}

// --- tool shape: description + well-formed input schema + handler ---
for (const t of MCP_TOOLS) {
  ok(typeof t.description === 'string' && t.description.length > 10, `${t.name}: has a real description`)
  ok(typeof t.handler === 'function', `${t.name}: has a handler`)
  const s = t.inputSchema
  ok(s && s.type === 'object', `${t.name}: schema is an object schema`)
  ok(s.additionalProperties === false, `${t.name}: schema rejects unknown keys`)
  const props = Object.keys(s.properties || {})
  ok((s.required || []).every((r) => props.includes(r)), `${t.name}: required ⊆ properties`)
  for (const [k, p] of Object.entries(s.properties || {})) {
    ok(typeof p.type === 'string' || Array.isArray(p.type), `${t.name}.${k}: property has a type`)
  }
}

// --- MCP_WIDGET_TYPES + per-user filtering ---
ok(MCP_WIDGET_TYPES.every((t) => WIDGET_MANIFEST.some((m) => m.type === t && m.mcp)), 'MCP_WIDGET_TYPES mirrors the manifest')
ok(toolsForWidgets(new Set()).length === 0, 'no enabled widgets -> no tools')
const remindersOnly = toolsForWidgets(new Set(['reminders']))
ok(remindersOnly.length > 0 && remindersOnly.every((t) => t.widget === 'reminders'), 'filtering returns exactly the enabled widget’s tools')
const two = toolsForWidgets(new Set(['daily', 'focus']))
ok(two.every((t) => t.widget === 'daily' || t.widget === 'focus') && two.some((t) => t.widget === 'daily') && two.some((t) => t.widget === 'focus'), 'filtering composes across widgets')

console.log(`mcp_contract: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
