# MCP access — let AI clients drive your widgets

The app embeds an [MCP](https://modelcontextprotocol.io) server at **`/mcp`**
(Streamable HTTP). Every dashboard widget exposes its own toolset — capture and
triage tasks, edit the calendar, search notes, plan the day — and each widget's
tools are **individually opt-in** from **Settings → MCP access**.

## Enable it

1. Settings → **MCP access**: turn on *Enable MCP access*.
2. **Generate token** — copy it immediately; it is shown once and only its hash
   is stored. *Anyone with this token can read and change everything in your
   account* (tasks, calendar, notes), so treat it like a password. Regenerate or
   revoke it any time from the same section.
3. Toggle on the widgets whose tools you want exposed (all off by default).
   Disabled widgets' tools are neither listed nor callable.

## Connect a client

```bash
claude mcp add --transport http reminders https://your-host/mcp \
  --header "Authorization: Bearer mcp_…"
```

Claude Desktop (`mcpServers` in its config):

```json
{
  "mcpServers": {
    "reminders": {
      "type": "http",
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer mcp_…" }
    }
  }
}
```

## Tools by widget

| Widget | Tools |
|---|---|
| Reminders | `reminders_list` · `reminders_capture` (natural language) · `reminders_create` · `reminders_update` · `reminders_complete` · `reminders_delete` · `reminders_groups_list` |
| Upcoming | `upcoming_agenda` |
| Calendar | `calendar_lists` · `calendar_events` · `calendar_create_event` · `calendar_update_event` · `calendar_delete_event` |
| Notes | `notes_list` · `notes_search` · `notes_read` · `notes_create` · `notes_update` · `notes_append` · `notes_backlinks` · `notes_trash` |
| Weekly Review | `review_stats` |
| Cues | `cues_list` · `cues_set` |
| Prioritize | `triage_queue` · `triage_matrix` · `triage_set` |
| Daily Plan | `daily_get_plan` · `daily_set_plan` · `daily_plan_add` · `daily_plan_remove` · `daily_suggestions` |
| Focus | `focus_next` |

Notes for tool callers: task `due_date`/`done_at` are ISO strings (`null` = none);
`date` parameters default to the **server-local** day — pass the user's local
`YYYY-MM-DD` when known (set the `TZ` env on the deployment to the user's
timezone to make the default match).

## Testing with curl

The transport requires BOTH accept types (else it answers 406):

```bash
H=(-H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
   -H 'accept: application/json, text/event-stream')
curl -s https://your-host/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl -s https://your-host/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s https://your-host/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"reminders_capture","arguments":{"text":"buy milk tomorrow !3"}}}'
```

## Design notes

- **Auth**: `/mcp` is the only bearer-token route; the rest of the API stays
  session-only. One token per user, SHA-256 at rest, `mcp_` prefix for secret
  scanners. Master-off and bad-token both answer an identical 401.
- **Stateless transport** (a fresh server per POST, JSON responses, no SSE): the
  tools capability needs no session state, and plain JSON keeps the compression
  middleware safe.
- **Single source of truth**: each widget's manifest descriptor declares its
  toolset (`mcp.tools`); `server/mcp_tools.js` implements it;
  `test/mcp_contract.test.mjs` fails CI on any drift.
- Rate limit: `MCP_RATE_LIMIT_PER_MIN` (default 60) per user.
