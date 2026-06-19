// JSDoc typedefs for the ctx capabilities the app delivers to widgets through the
// connection layer (connections.js). Pure documentation — no runtime exports — so
// an editor can offer types/autocompletion for `ctx.tasks`, `ctx.groups`, etc.
// The prose contract lives in docs/widget-sdk.md.

/**
 * ctx.tasks — the single shared task store plus its mutations and change bus.
 * Read it with `useTaskList(ctx.tasks, selector)`; use the lower-level members for
 * non-React access (the Calendar) or optimistic patches (Cues).
 * @typedef {Object} TasksCapability
 * @property {(fn: () => void) => (() => void)} subscribe  subscribe to store changes; returns an unsubscribe.
 * @property {() => Array<Object>} getTasks  current task list (stable ref between actual changes).
 * @property {() => ('loading'|'ready'|'error')} getState  store load state.
 * @property {() => Promise<Array>} refresh  force-reload /api/tasks.
 * @property {() => Promise<Array>} ensureLoaded  resolve with tasks, loading first if needed.
 * @property {(id: (number|string), patch: Object) => void} patchTask  optimistic in-place merge.
 * @property {(id: (number|string)) => void} removeTask  optimistic remove.
 * @property {(next: Array) => void} replaceTasks  wholesale replace (e.g. revert to a snapshot).
 * @property {(id: (number|string), patch: Object) => Promise<Object>} update  persist an edit (POST /api/tasks/:id).
 * @property {(projectId: (number|string), body: Object) => Promise<Object>} create  create a task (PUT /api/projects/:id/tasks).
 * @property {(id: (number|string)) => Promise<Object>} del  delete a task.
 * @property {(id: (number|string), names: string[]) => Promise<void>} attachLabels  resolve-or-create + attach labels.
 * @property {() => void} emitChanged  broadcast "a task changed" so the store reconciles with the server.
 * @property {(fn: () => void) => (() => void)} onChanged  subscribe to that broadcast.
 * @property {(d: string) => boolean} isRealDate  helper: a present, non-zero, valid date.
 */

/**
 * ctx.groups — reminder groups (calendar-coupled tags).
 * @typedef {Object} GroupsCapability
 * @property {() => Promise<{groups: Array<{name: string}>, calendars?: Array}>} fetch
 * @property {() => string[]} recent  recently used group names (device-local).
 * @property {(name: string) => void} pushRecent
 * @property {(name: string) => void} onNewGroup  open Settings prefilled to create a group.
 */

/**
 * ctx.notes — Markdown notes over WebDAV/Nextcloud. Carries every notesApi method
 * (list/get/save/create/rename/move/duplicate/pin/trash/restore/search/folders/
 * browse/config/…) plus the open-note bus:
 * @typedef {Object} NotesCapability
 * @property {(fn: (path: string) => void) => (() => void)} onOpenNote
 * @property {(path: string) => void} emitOpenNote
 */

/**
 * ctx.calendar — CalDAV calendar events (VEVENT).
 * @typedef {Object} CalendarCapability
 * @property {(start: string, end: string) => Promise<{events: Array}>} listEvents
 * @property {(body: Object) => Promise<Object>} createEvent
 * @property {(body: Object) => Promise<Object>} updateEvent
 * @property {(body: Object) => Promise<Object>} deleteEvent
 * @property {() => Promise<{accounts: Array}>} accounts  linked CalDAV accounts + their lists.
 */

/**
 * The object a widget receives — ONLY the keys whose interfaces it declared in its
 * manifest `plugs` (least privilege; see connections.js).
 * @typedef {Object} WidgetCtx
 * @property {TasksCapability} [tasks]
 * @property {GroupsCapability} [groups]
 * @property {NotesCapability} [notes]
 * @property {CalendarCapability} [calendar]
 * @property {Array} [events]  reminder-events SSE feed.
 * @property {Array} [projects]  CalDAV task projects/lists (inbox is projects[0]).
 * @property {(opts?: Object) => void} [onOpenSettings]
 */

export {}
