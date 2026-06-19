# BFF API contract (`/api/*`)

The Node/Express BFF (`server/index.js`) is the only thing the SPA talks to; it
proxies the user's CalDAV (tasks, calendar) and WebDAV/Nextcloud (notes) and keeps
a little state in SQLite (layouts, dashboards, encrypted account config, sessions).

Conventions:

- **Auth**: every `/api/*` route is behind `requireAuth` (401 `{ error:
  'unauthenticated' }` when the session is missing; the client redirects to login).
  `/auth/*` and `/healthz` are public.
- **Errors**: handlers forward to the JSON error handler via `next(e)` — `4xx`
  carry `{ error: <message> }`, `5xx` are `{ error: 'internal error' }`.
- **Bodies/responses** are JSON (`express.json`, 10mb) except note resource uploads
  (`PUT /api/notes/resources/:name`), which stream raw binary (25mb).
- Widgets never call these directly — they go through the `ctx` capabilities
  (see `docs/widget-sdk.md`). This list is the capabilities' backing contract.

## Auth & health

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness + whether OIDC is configured (public) |
| GET | `/auth/login` | start the OIDC login redirect |
| GET | `/auth/callback` | OIDC callback → set session, redirect to `/` |
| GET | `/auth/logout` | destroy session + OIDC logout redirect |
| GET | `/api/me` | the current session user |

## Dashboard & layouts (SQLite)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/layouts/:id` | a dashboard's saved widget layout |
| PUT | `/api/layouts/:id` | save a dashboard's layout (JSON object) |
| GET | `/api/dashboards` | the dashboard list (names + order) |
| PUT | `/api/dashboards` | save the dashboard list (≤24) |
| DELETE | `/api/dashboards/:id` | delete a dashboard's layout |

## Reminder events (SSE)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/events` | per-user SSE feed of reminder/overdue events (VALARM poller). Backs `ctx.events`. |

## CalDAV accounts, tasks, calendar

| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/api/caldav/accounts` | linked accounts + their lists | `ctx.calendar.accounts` |
| POST | `/api/caldav/accounts` | add/connect an account | Settings |
| POST | `/api/caldav/accounts/:id/discover` | re-discover an account's lists | Settings |
| PUT | `/api/caldav/accounts/:id/lists` | set which lists sync | Settings |
| DELETE | `/api/caldav/accounts/:id` | remove an account | Settings |
| GET | `/api/caldav/tasks` | raw CalDAV tasks (decorative counts) | Settings |
| GET | `/api/calendar/events?start&end` | VEVENTs in a range | `ctx.calendar.listEvents` |
| POST | `/api/calendar/events` | create an event | `ctx.calendar.createEvent` |
| PATCH | `/api/calendar/events` | edit/move/resize an event | `ctx.calendar.updateEvent` |
| DELETE | `/api/calendar/events` | delete an event | `ctx.calendar.deleteEvent` |

## Tasks / projects / labels (CalDAV-backed)

| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/api/projects` | task projects/lists (inbox is `[0]`) | `ctx.projects` |
| GET | `/api/projects/:id/tasks` | tasks in a project | — |
| PUT | `/api/projects/:id/tasks` | create a task | `ctx.tasks.create` |
| GET | `/api/tasks` | the whole task list (shared store) | `ctx.tasks` (store) |
| POST | `/api/tasks/:id` | patch a task | `ctx.tasks.update` |
| DELETE | `/api/tasks/:id` | delete a task | `ctx.tasks.del` |
| GET | `/api/labels` | labels | — |
| PUT | `/api/labels` | create a label | `ctx.tasks.attachLabels` |
| PUT | `/api/tasks/:id/labels` | attach a label to a task | `ctx.tasks.attachLabels` |

## Reminder groups ↔ calendars (SQLite mapping)

| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/api/reminder-groups` | groups + calendars | `ctx.groups.fetch` |
| PUT | `/api/reminder-groups` | map/create a group → calendar | Settings |
| DELETE | `/api/reminder-groups` | delete a group (optionally its calendar) | Settings |

## Notes (Markdown over WebDAV/Nextcloud)

Backs `ctx.notes` (the `notesApi` client). `configured: false` from `GET
/api/notes` means no Nextcloud account/folder is set up yet.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notes` | list notes (+ `configured` flag) |
| GET | `/api/notes/search?q&limit` | full-text body search (FTS) |
| GET | `/api/notes/backlinks?path` | backlinks to a note |
| GET / PUT | `/api/notes/config` | get / set the WebDAV account + root folder |
| GET | `/api/notes/browse?path` | browse folders (for the folder picker) |
| GET / POST | `/api/notes/folders` | list / create folders |
| POST | `/api/notes` | create a note |
| GET | `/api/notes/item?path` | read a note (body + etag + tags) |
| PUT | `/api/notes/item` | save a note (optimistic-concurrency etag) |
| POST | `/api/notes/rename` | rename a note |
| POST | `/api/notes/pin` | pin/unpin |
| POST | `/api/notes/duplicate` | duplicate |
| POST | `/api/notes/move` | move a note to a folder |
| POST | `/api/notes/move-folder` | move a folder |
| DELETE | `/api/notes/item?path` | hard-delete a note |
| GET / POST | `/api/notes/trash` | list trash / trash a note |
| POST | `/api/notes/restore` | restore from trash |
| POST | `/api/notes/trash/empty` | empty the trash |
| GET / PUT | `/api/notes/resources/:name` | fetch / upload an embedded image or drawing (raw binary) |

Any other `/api/*` returns `404 { error: 'not found' }` (JSON, so the SPA never
receives an HTML page for a missing endpoint).
