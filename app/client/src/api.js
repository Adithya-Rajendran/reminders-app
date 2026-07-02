// ---------------------------------------------------------------------------
// Entity shapes — the request/response contract every widget couples to, spelled
// out once here as JSDoc typedefs (comment-only; no runtime effect). These are the
// shapes the `ctx` capabilities deliver (see docs/adding-a-widget.md); the full
// route table lives in docs/api.md. Keep these in sync with the server serializers
// (server/tasks_caldav.js serializeVtodo, server/caldav.js parseVevents,
// server/notes.js, server/reminder_groups.js, server/daily_plan.js, server/mcp.js).
//
// Convention: cleared task/event dates are the sentinel ZERO_DATE
// ('0001-01-01T00:00:00.000Z'), never null. Timestamps are ISO-8601 UTC strings.

/**
 * A task — a VTODO in one of the user's CalDAV lists, normalized to this app's
 * shape (source: server/tasks_caldav.js `serializeVtodo`).
 * @typedef {Object} Task
 * @property {string} id            Opaque encoded `listId + objectUrl` — address for patch/delete.
 * @property {number} project_id    The task list (Project.id) this VTODO lives in.
 * @property {string} uid           The VTODO UID (stable across edits).
 * @property {string} title         Summary.
 * @property {string} description   Plain-text description (this app's metadata stripped out).
 * @property {boolean} done         Completed (STATUS:COMPLETED).
 * @property {string} done_at       Completion time (ISO UTC) or ZERO_DATE.
 * @property {string} due_date      Due date/time (ISO UTC) or ZERO_DATE when unset.
 * @property {number} priority      This app's 0–5 scale (0 none … 5 DO NOW); maps to iCal 1–9 on the wire.
 * @property {number} repeat_after  Recurrence interval (0 = none).
 * @property {number} repeat_mode   Recurrence mode.
 * @property {string} [cue]         Implementation-intention cue text.
 * @property {string} [cue_trigger] The cue's trigger.
 * @property {number} [dread]       "Dread" level (this app's metadata).
 * @property {number} [time_estimate] Estimate in minutes.
 * @property {string[]} [habit_log] ISO dates a recurring task was completed (streaks).
 * @property {boolean} [is_goal]    Marks the task as a goal.
 * @property {string} [goal]        Parent goal UID.
 * @property {string} [goal_plan]   Free-text plan for a goal.
 * @property {*} [flow]             Flow/next-action metadata.
 * @property {Array<{reminder:string}>} reminders  VALARM-derived reminders.
 * @property {Label[]} labels       CATEGORIES as labels.
 * @property {string} created       Created time (ISO UTC) or ZERO_DATE.
 * @property {string} updated       Last-modified time (ISO UTC) or ZERO_DATE.
 */

/**
 * A label (a CalDAV CATEGORY — free text, no server object).
 * @typedef {Object} Label
 * @property {string} id            Encoded label id (`cat_…`).
 * @property {string} title         The category name.
 * @property {string} hex_color     Always '' (CATEGORIES carry no color).
 */

/**
 * A task project/list (a CalDAV calendar that supports VTODOs).
 * @typedef {Object} Project
 * @property {number} id            List id.
 * @property {string} title         Display name (or URL fallback).
 * @property {string} hex_color     Calendar color, or ''.
 * @property {boolean} is_inbox     True for the default "Reminders"/first list.
 * @property {string} description   Always '' (kept for shape parity).
 * @property {number} parent_project_id  Always 0 (flat lists).
 */

/**
 * A calendar event — a VEVENT (source: server/caldav.js `parseVevents`). Address
 * an event for edit/delete by { accountId, objectUrl }.
 * @typedef {Object} CalendarEvent
 * @property {string} id            `evt-<uid>`.
 * @property {string} title         Summary.
 * @property {string} start         UTC ISO (timed) or 'YYYY-MM-DD' (all-day).
 * @property {?string} end          Same format as `start`, or null.
 * @property {boolean} allDay       Whether DTSTART is a DATE (no time).
 * @property {string} accountId     Owning CalDAV account id.
 * @property {string} listUrl       Owning calendar URL.
 * @property {string} objectUrl     The VEVENT resource URL.
 * @property {string} [etag]        Resource etag (optimistic concurrency).
 */

/**
 * A note list item — front-matter + file metadata, no body (source:
 * server/notes.js `listNotes`). `ctx.notes.list()` returns these.
 * @typedef {Object} NoteMeta
 * @property {string} path          WebDAV path (the note's id).
 * @property {string} title         Derived from the filename.
 * @property {string} folder        Folder relative to the notes root ('' = root).
 * @property {string[]} tags        Front-matter tags.
 * @property {?string} created      ISO created time from front-matter, or null.
 * @property {boolean} pinned       Pinned flag.
 * @property {string} updated       WebDAV mtime.
 * @property {string} etag          Resource etag (optimistic concurrency).
 * @property {number} size          File size in bytes.
 */

/**
 * A full note — a NoteMeta-addressed file with its parsed front-matter and body
 * (source: server/notes.js `getNote`). `ctx.notes.get(path)` returns this.
 * @typedef {Object} Note
 * @property {string} path          WebDAV path.
 * @property {string} title         Derived from the filename.
 * @property {string} folder        Folder relative to the notes root.
 * @property {Object} meta          Parsed YAML front-matter ({ id, created, updated, tags?, pinned?, … }).
 * @property {string} body          Markdown body (front-matter stripped).
 * @property {string} etag          Resource etag.
 */

/**
 * A reminder group — a CATEGORIES tag mapped to its own CalDAV calendar (source:
 * server/reminder_groups.js `listGroups`). `ctx.groups.fetch()` resolves
 * `{ groups: Group[], calendars: [{ id, name }] }`.
 * @typedef {Object} Group
 * @property {string} name          The group name (the CATEGORIES tag).
 * @property {number} listId        The mapped calendar's list id.
 * @property {?string} calendar     The mapped calendar's display name, or null if unresolved.
 * @property {number} count         Reminders tagged with this group.
 */

/**
 * The server-stored daily plan — the ids picked for one day (source:
 * server/daily_plan.js). `ctx.plan.get(date)` returns this.
 * @typedef {Object} DailyPlan
 * @property {string} date          The plan's day as the client's local 'YYYY-MM-DD'.
 * @property {string[]} ids         Selected Task ids (deduped, order preserved).
 */

/**
 * MCP access settings for the current user (source: server/mcp.js
 * `settingsPayload`).
 * @typedef {Object} McpSettings
 * @property {boolean} enabled      Whether MCP access is on.
 * @property {Object.<string, boolean>} widgets  Per-widget-type tool opt-in map.
 * @property {boolean} hasToken     Whether a token has been generated.
 * @property {?string} tokenCreatedAt  When the current token was created (ISO), or null.
 * @property {?string} lastUsedAt   When the token was last used (ISO), or null.
 */

// ---------------------------------------------------------------------------

// Thin fetch wrapper. On 401 we bounce to the BFF login route, which starts
// the OIDC flow against Authentik.
/**
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<*>} Parsed JSON (or text when the response isn't JSON).
 *   Throws on non-2xx with `.status` attached; a 401 redirects to login.
 */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (res.status === 401) {
    window.location.href = '/auth/login'
    throw new Error('unauthenticated')
  }
  if (!res.ok) {
    const e = new Error((await res.text()) || res.statusText)
    // Attach the HTTP status so callers can distinguish 409 (conflict) from
    // 5xx network errors without parsing the message string.
    e.status = res.status
    throw e
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('json') ? res.json() : res.text()
}

// Task / project / label API (CalDAV-backed), served by the BFF.
/**
 * `api()` with the `/api` prefix — the task/project/label routes. Returns whatever
 * the addressed route returns (e.g. {@link Task}[] from `/tasks`, {@link Project}[]
 * from `/projects`).
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<*>}
 */
export const tk = (path, opts) => api('/api' + path, opts)

// Reminder groups ↔ calendars.
/** @returns {Promise<{ groups: Group[], calendars: Array<{id:number,name:string}> }>} */
export const reminderGroups = () => api('/api/reminder-groups')

// Notes (Markdown files in the user's Nextcloud, via WebDAV) + binary resources.
// Backs ctx.notes. See docs/api.md for the per-route request/response shapes.
const qp = (p) => '?path=' + encodeURIComponent(p)
export const notesApi = {
  /** @returns {Promise<{ configured: boolean, notes: NoteMeta[] }>} */
  list: () => tk('/notes'),
  search: (q, limit = 30) => tk('/notes/search?q=' + encodeURIComponent(q) + '&limit=' + limit),
  backlinks: (path) => tk('/notes/backlinks' + qp(path)),
  config: () => tk('/notes/config'),
  setConfig: (accountId, rootPath) => tk('/notes/config', { method: 'PUT', body: JSON.stringify({ accountId, rootPath }) }),
  browse: (path = '') => tk('/notes/browse' + qp(path)),
  /** @returns {Promise<Note>} */
  create: (folder, title) => tk('/notes', { method: 'POST', body: JSON.stringify({ folder, title }) }),
  /** @returns {Promise<Note>} */
  get: (path) => tk('/notes/item' + qp(path)),
  /** @returns {Promise<{ path: string, meta: Object, etag: string }>} */
  save: (path, body, etag, tags) => tk('/notes/item', { method: 'PUT', body: JSON.stringify({ path, body, etag, tags }) }),
  rename: (path, title) => tk('/notes/rename', { method: 'POST', body: JSON.stringify({ path, title }) }),
  setPinned: (path, pinned) => tk('/notes/pin', { method: 'POST', body: JSON.stringify({ path, pinned }) }),
  duplicate: (path) => tk('/notes/duplicate', { method: 'POST', body: JSON.stringify({ path }) }),
  move: (path, folder) => tk('/notes/move', { method: 'POST', body: JSON.stringify({ path, folder }) }),
  moveFolder: (from, to) => tk('/notes/move-folder', { method: 'POST', body: JSON.stringify({ from, to }) }),
  folders: () => tk('/notes/folders'),
  createFolder: (folder) => tk('/notes/folders', { method: 'POST', body: JSON.stringify({ folder }) }),
  del: (path) => tk('/notes/item' + qp(path), { method: 'DELETE' }),
  trash: (path) => tk('/notes/trash', { method: 'POST', body: JSON.stringify({ path }) }),
  trashList: () => tk('/notes/trash'),
  restore: (path) => tk('/notes/restore', { method: 'POST', body: JSON.stringify({ path }) }),
  emptyTrash: () => tk('/notes/trash/empty', { method: 'POST' }),
  uploadResource: async (name, blob, contentType) => {
    const res = await fetch('/api/notes/resources/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'content-type': contentType || blob.type || 'application/octet-stream' }, body: blob,
    })
    if (res.status === 401) { window.location.href = '/auth/login'; throw new Error('unauthenticated') }
    if (!res.ok) throw new Error((await res.text()) || 'upload failed')
    return res.json()
  },
}
