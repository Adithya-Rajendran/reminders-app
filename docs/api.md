# The `/api/*` contract

The Node/Express BFF (`app/server/index.js`) is the only backend the SPA talks
to. It's a thin layer over the user's **CalDAV** (tasks, calendar) and
**WebDAV/Nextcloud** (notes), with a little state in **SQLite** (layouts,
dashboards, encrypted account config, sessions, the daily plan, MCP settings).

This is the request/response contract every widget couples to — the shapes behind
the `ctx` capabilities (see [`docs/widget-sdk.md`](./widget-sdk.md) and
[`docs/adding-a-widget.md`](./adding-a-widget.md)). Widgets **never** call these
routes directly; they go through `ctx`. The entity shapes (`Task`,
`CalendarEvent`, `Note`, `NoteMeta`, `Group`, `DailyPlan`, `McpSettings`) are also
declared as JSDoc `@typedef`s at the top of `app/client/src/api.js`.

## Conventions

- **Auth.** Every `/api/*` route is behind `requireAuth`. A missing/expired
  session gets `401 { error: 'unauthenticated' }`; the client's `api()` helper
  redirects to `/auth/login` on a 401. The public routes are `/healthz`,
  `/auth/*`, and (bearer-auth, not session) `/mcp`. The "Auth" column below is
  `session` unless noted.
- **Bodies & responses** are JSON (`express.json`, 10 MB cap) — **except** note
  resource uploads (`PUT /api/notes/resources/:name`), which stream raw binary
  (25 MB cap).
- **Errors** forward to one JSON error handler via `next(e)`: a caught error's
  `status`/`statusCode` is honored, else `500`. `4xx` bodies carry
  `{ error: <message> }`; `5xx` collapse to `{ error: 'internal error' }`. A few
  handlers respond directly with a specific message (task create/patch/delete map
  upstream CalDAV failures to `400`/`403`/`409`/`502`).
- **Dates.** Task/event timestamps are ISO-8601 UTC strings; a *cleared* date is
  the sentinel `ZERO_DATE` (`'0001-01-01T00:00:00.000Z'`), never `null`. Daily
  plan dates are the client's local `YYYY-MM-DD`.
- Any unmatched `/api/*` returns `404 { error: 'not found' }` (JSON, so the SPA
  never receives an HTML page for a missing endpoint).

## Auth & health

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/healthz` | — | `{ ok: true, oidc: boolean }` | public |
| GET | `/auth/login` | — | 302 → OIDC provider | public |
| GET | `/auth/callback` | `?code&state` | 302 → `/` (sets session) | public |
| GET | `/auth/logout` | — | 302 → OIDC logout (destroys session) | public |
| GET | `/api/me` | — | the session user `{ sub, email, name }` | session |

## Dashboard & layouts (SQLite)

Layouts and the dashboard list persist in SQLite (cheap to recreate). `layout` is
an opaque widget-grid blob the client owns; the server only stores/returns it.

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/api/layouts/:id` | — | `{ layout: object\|null, version }` | session |
| PUT | `/api/layouts/:id` | `{ layout: {...} }` (JSON object) | `{ ok: true }` — `400` if body isn't an object | session |
| GET | `/api/dashboards` | — | `{ dashboards: [{ id, name }] }` | session |
| PUT | `/api/dashboards` | `{ dashboards: [{ id, name }] }` (1–24) | `{ ok: true }` — `400` on bad/empty list or reserved id | session |
| DELETE | `/api/dashboards/:id` | — | `{ ok: true }` — `400` on the reserved index id | session |

## Reminder events (SSE) — backs `ctx.events`

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/api/events` | — | `text/event-stream`; `reminder` events carry `{ ... }` reminder payloads (VALARM poller). Never gzip-buffered (`Cache-Control: no-transform`). | session |

## Daily plan (SQLite) — backs `ctx.plan`

The small set of task ids the user picked for "today" — only the *selection*
lives here (ids into the CalDAV task store), never the tasks themselves.

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/api/daily-plan?date=YYYY-MM-DD` | — | `DailyPlan` = `{ date, ids: string[] }` — `400` if `date` isn't `YYYY-MM-DD` | session |
| PUT | `/api/daily-plan` | `{ date, ids: string[] }` | `DailyPlan` (deduped, order preserved; caps: ≤100 ids, ≤512 chars each) | session |

## CalDAV accounts (Settings)

`GET /api/caldav/accounts` backs `ctx.calendar.accounts()`; the rest are
Settings-only (account management). Passwords are write-only (encrypted at rest,
never returned).

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/api/caldav/accounts` | — | `{ accounts: [{ id, name, type, serverUrl, username, lists:[…] }] }` | session |
| POST | `/api/caldav/accounts` | `{ name, type, serverUrl?, username, password }` (`serverUrl` optional only for `icloud`) | `{ account: {…} }` — `400` on missing fields / bad connection. Rate-limited (probes CalDAV). | session |
| POST | `/api/caldav/accounts/:id/discover` | — | `{ lists: [...] }` — `404` unknown id, `400` on failure. Rate-limited. | session |
| PUT | `/api/caldav/accounts/:id/lists` | `{ enabled: string[] }` (list URLs to sync) | `{ ok: true, lists: [...] }` | session |
| DELETE | `/api/caldav/accounts/:id` | — | `{ ok: true }` | session |
| GET | `/api/caldav/tasks` | — | `{ tasks: [...] }` — raw CalDAV tasks for Settings' decorative counts; partial `200` on a failing list, `500` on a DB/crypto failure | session |

## Calendar events (CalDAV VEVENT) — backs `ctx.calendar`

A `CalendarEvent` is `{ id, title, start, end, allDay, accountId, listUrl, objectUrl, etag }`.
`start`/`end` are UTC ISO for timed events, `YYYY-MM-DD` for all-day; `end` may be
`null`. Edits/deletes address an event by `accountId` + `objectUrl`.

| Method | Path | Request | Response | Capability | Auth |
|---|---|---|---|---|---|
| GET | `/api/calendar/events?start&end` | ISO range | `{ events: CalendarEvent[] }` — `400` without `start`/`end`, `502` upstream | `ctx.calendar.listEvents(start, end)` | session |
| POST | `/api/calendar/events` | `{ accountId, listUrl, summary?, start, end?, allDay? }` | `{ ok: true, event: CalendarEvent }` — `400` on bad dates, `404` unknown account | `ctx.calendar.createEvent(body)` | session |
| PATCH | `/api/calendar/events` | `{ accountId, objectUrl, summary?, start?, end?, allDay? }` | `{ ok: true }` — `400`/`404`/`502` | `ctx.calendar.updateEvent(body)` | session |
| DELETE | `/api/calendar/events` | `{ accountId, objectUrl }` | `{ ok: true }` | `ctx.calendar.deleteEvent(body)` | session |

## Tasks / projects / labels (CalDAV VTODO) — backs `ctx.tasks` / `ctx.projects`

Tasks are VTODOs in the user's CalDAV lists. A `Task` id is an opaque encoded
`listId + objectUrl` string. A `Project` is a task list:
`{ id, title, hex_color, is_inbox, description, parent_project_id }`. The full
`Task` shape (title, done, due_date, priority 0–5, reminders, labels, recurrence,
plus this app's metadata — cue/dread/estimate/goal/habit) is the `Task` `@typedef`
in `api.js`.

| Method | Path | Request | Response | Capability | Auth |
|---|---|---|---|---|---|
| GET | `/api/projects` | — | `Project[]` (inbox is `[0]`) | `ctx.projects` | session |
| GET | `/api/projects/:id/tasks` | `?per_page` (≤250) | `Task[]` | — | session |
| PUT | `/api/projects/:id/tasks` | task fields `{ title, … }` | `201` → the created `Task` — `400` no title, `403` read-only list, `409` no writable list | `ctx.tasks.create(projectId, fields)` | session |
| GET | `/api/tasks` | `?per_page&sort_by&order_by` | `Task[]` (the shared store's source) | `ctx.tasks` (store) | session |
| POST | `/api/tasks/:id` | partial task fields (`{ done }`, `{ due_date, reminders }`, `{ priority }`, …) | the updated `Task` — `400`/`404`/`409`/`502` | `ctx.tasks.update(id, patch)` | session |
| DELETE | `/api/tasks/:id` | — | `{ ok: true, message }` — `400`/`404`/`502` | `ctx.tasks.del(id)` | session |
| GET | `/api/labels` | — | `[{ id, title, hex_color }]` (CATEGORIES in use) | — | session |
| PUT | `/api/labels` | `{ title }` | `{ id, title, hex_color }` (free-text; no server object) | — | session |
| PUT | `/api/tasks/:id/labels` | `{ label_id }` or `{ title }` | `{ ok: true, label_id }` | `ctx.tasks.attachLabels(id, titles)` | session |

Recurring tasks: patching `{ done: true }` on a recurring VTODO advances it to the
next occurrence instead of completing it — the response `Task` comes back with
`done: false` and a bumped `due_date` (that's how `useTaskList` decides between
"Completed" and "Rescheduled ↻"). Priority is this app's 0–5 scale (0 none … 5 DO
NOW), mapped to/from iCalendar's 1–9 on the wire.

## Reminder groups ↔ calendars (SQLite mapping) — backs `ctx.groups`

A reminder *group* is a CATEGORIES tag mapped to its own CalDAV calendar (so each
group syncs as its own task list). `GET` backs `ctx.groups.fetch()`; map/delete
are Settings-only.

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/api/reminder-groups` | — | `{ groups: Group[], calendars: [{ id, name }] }` where `Group` = `{ name, listId, calendar, count }` | session |
| PUT | `/api/reminder-groups` | `{ group, listId? , createNew? }` | `{ name, listId, moved }` — `400` no group / no target, `409` no account to seed from | session |
| DELETE | `/api/reminder-groups` | `?group&deleteCalendar=1` (or body `{ group, deleteCalendar }`) | `{ deletedCalendar }` or `{ ungrouped }` (kept reminders are moved to the default calendar with the tag stripped) | session |

## Notes (Markdown over WebDAV/Nextcloud) — backs `ctx.notes`

Notes are Markdown files in the user's Nextcloud. `GET /api/notes` returns
`{ configured: false, notes: [] }` until a Nextcloud account + root folder is set
up. A list item (`NoteMeta`) is
`{ path, title, folder, tags, created, pinned, updated, etag, size }`; a full note
(`Note`) adds the parsed front-matter `meta` and `body`
(`{ path, title, folder, meta, body, etag }`). Paths are passed as a `path` query
param on GET/DELETE and in the body on POST/PUT.

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| GET | `/api/notes` | — | `{ configured, notes: NoteMeta[] }` | session |
| GET | `/api/notes/search?q&limit` | `q`, `limit` (1–50, default 30) | `{ results: [...] }` (full-text body search) | session |
| GET | `/api/notes/backlinks?path` | `path` | `{ backlinks: [...] }` | session |
| GET | `/api/notes/config` | — | `{ accountId, rootPath, accounts:[{id,name,type}], configured }` | session |
| PUT | `/api/notes/config` | `{ accountId, rootPath }` | `{ accountId, rootPath }` | session |
| GET | `/api/notes/browse?path` | `path` | `{ path, folders:[{name,path}] }` (folder picker) | session |
| GET | `/api/notes/folders` | — | `{ folders: string[] }` | session |
| POST | `/api/notes/folders` | `{ folder }` | the created folder | session |
| POST | `/api/notes` | `{ folder?, title? }` | `201` → `Note` (empty body) | session |
| GET | `/api/notes/item?path` | `path` | `Note` — `404` if missing | session |
| PUT | `/api/notes/item` | `{ path, body, etag?, tags? }` | `{ path, meta, etag }` — `409` on an etag conflict (edited elsewhere) | session |
| POST | `/api/notes/rename` | `{ path, title }` | `{ path, title, etag }` | session |
| POST | `/api/notes/pin` | `{ path, pinned }` | updated meta | session |
| POST | `/api/notes/duplicate` | `{ path }` | `201` → the copy | session |
| POST | `/api/notes/move` | `{ path, folder }` | updated note | session |
| POST | `/api/notes/move-folder` | `{ from, to }` | result | session |
| DELETE | `/api/notes/item?path` | `path` | `{ ... }` (hard delete) | session |
| GET | `/api/notes/trash` | — | `{ notes: [...] }` | session |
| POST | `/api/notes/trash` | `{ path }` | trash result | session |
| POST | `/api/notes/restore` | `{ path }` | restore result | session |
| POST | `/api/notes/trash/empty` | — | result | session |
| GET | `/api/notes/resources/:name` | — | the raw image/drawing bytes (`Content-Type` set; cached 1 day) — `404` if missing | session |
| PUT | `/api/notes/resources/:name` | **raw binary** body (25 MB) | `{ ... }` (upload an embedded image/drawing) | session |

## MCP (see [`docs/mcp.md`](./mcp.md))

`/mcp` itself is the Model Context Protocol transport (Streamable HTTP,
**bearer**-token auth, stateless — no session, `GET`/`DELETE` return 405). The
management routes below are normal session auth (Settings → MCP access).

| Method | Path | Request | Response | Auth |
|---|---|---|---|---|
| POST | `/mcp` | JSON-RPC (MCP) | JSON-RPC | **bearer** (per-user token) |
| GET / DELETE | `/mcp` | — | `405` (stateless transport) | bearer |
| GET | `/api/mcp/settings` | — | `McpSettings` = `{ enabled, widgets: { [widgetType]: boolean }, hasToken, tokenCreatedAt, lastUsedAt }` | session |
| PUT | `/api/mcp/settings` | `{ enabled?, widgets? }` (`widgets` merges, not replaces) | the updated `McpSettings` — `400` if `widgets` isn't an object of `{ type: boolean }` | session |
| POST | `/api/mcp/token` | — | `{ token }` — the plaintext token, shown **once** (only its hash is stored); replaces any prior token | session |
| DELETE | `/api/mcp/token` | — | `{ ok: true }` (revoke) | session |
