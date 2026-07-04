// The MCP tool registry: every tool a widget exposes over /mcp, grouped by
// widget type. PURE DATA + handlers ({ name, widget, description, inputSchema,
// handler }) — no SDK types here, so test/mcp_contract.test.mjs can validate the
// registry against the widget manifest (the single source of truth for which
// widget owns which tool) without a server.
//
// Handlers call the same internal functions the HTTP handlers use (never HTTP to
// self), take (ctx = { sub }, args) and return JSON-serializable results; they
// throw err(msg, status) for user-visible failures (the /mcp layer converts those
// to in-band tool errors). List-returning tools take `limit` and return COMPACT
// task shapes (see brief()) — full VTODO wire objects are noisy for LLM clients.
import { WIDGET_MANIFEST } from '../client/src/widgets/manifest.js'
import { parseQuickAdd, cueTriggerOf, isRealDate } from '../client/src/tasklib.js'
import {
  selectUpcoming, selectStalled, selectTriagedThisWeek, selectCued,
  groupEisenhower, dueBucket, UPCOMING_ORDER, byImportanceThenDue, orderPlanFirst, needsTriage, labelGroup,
} from '../client/src/taskviews.js'
import { computeReview } from '../client/src/reviewstats.js'
import {
  allUserVtodos, serializeVtodo, sortTasks,
  createTaskCore, patchTaskCore, deleteTaskCore,
} from './tasks_caldav.js'
import { fetchEvents, createEvent, updateEvent, deleteEvent, invalidateUserEventCache } from './caldav.js'
import { listGroups } from './reminder_groups.js'
import * as notes from './notes.js'
import { getPlan, setPlan, addToPlan, removeFromPlan, todayYmd } from './daily_plan.js'
import { listAccounts, getAccount, enabledListsForAccount, listsWithId } from './config.js'
import { err } from './util.js'

// ---- shared shapes ----
const ZERO = '0001-01-01T00:00:00Z'
const iso = (v) => (v && v !== ZERO ? v : null) // ZERO_DATE sentinel -> null for clients

// Compact task shape for tool results: everything an assistant needs to reason
// and act (ids for follow-up calls), without the VTODO bookkeeping fields.
function brief(t) {
  return {
    id: t.id, project_id: t.project_id, title: t.title,
    description: t.description ? String(t.description).slice(0, 280) : '',
    done: !!t.done, due_date: iso(t.due_date), done_at: iso(t.done_at),
    priority: t.priority || 0, time_estimate: t.time_estimate || 0, important: !!t.important,
    labels: (t.labels || []).map((l) => l.title),
    cue: t.cue || '', repeat_after: t.repeat_after || 0,
    reminders: (t.reminders || []).map((r) => r.reminder),
  }
}

async function allTasks(sub) {
  return (await allUserVtodos(sub)).map(({ vt, listId, objectUrl }) => serializeVtodo(vt, listId, objectUrl))
}
const openTasks = (tasks) => tasks.filter((t) => !t.done && !t.is_goal)

// The same inbox convention as listProjects: the "Reminders" list, else the
// first enabled VTODO list.
async function inboxProjectId(sub) {
  const lists = (await listsWithId(sub)).filter((l) => l.supports_vtodo && l.enabled)
  const inbox = lists.find((l) => /^reminders$/i.test(String(l.display_name || '').trim())) || lists[0]
  if (!inbox) throw err('no task list — connect a CalDAV account in Settings first', 409)
  return inbox.id
}

const clampLimit = (v, def, max = 250) => Math.max(1, Math.min(max, Math.trunc(Number(v) || def)))
const planDate = (v) => (v == null || v === '' ? todayYmd() : v)

// ---- schema fragments ----
const S = {
  taskId: { type: 'string', minLength: 1, maxLength: 512 },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  isoDate: { type: 'string', minLength: 4, maxLength: 40 },
  limit: { type: 'integer', minimum: 1, maximum: 250 },
  priority: { type: 'integer', minimum: 0, maximum: 5 },
  important: { type: 'boolean' },
}
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

// Optional task fields shared by reminders_create / reminders_update.
const TASK_FIELDS = {
  title: { type: 'string', minLength: 1, maxLength: 500 },
  description: { type: 'string', maxLength: 5000 },
  due_date: { ...S.isoDate },
  priority: S.priority,
  labels: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  time_estimate: { type: 'integer', minimum: 0, maximum: 6000 },
  important: S.important,
  cue: { type: 'string', maxLength: 500 },
  repeat_after: { type: 'integer', minimum: 0, maximum: 3650 },
  repeat_mode: { type: 'integer', minimum: 0, maximum: 2 },
}

// Build the create/update body the task cores expect from validated args,
// deriving cue_trigger from a cue the way the widgets do.
function taskBody(args) {
  const b = {}
  for (const k of Object.keys(TASK_FIELDS)) if (args[k] !== undefined) b[k] = args[k]
  if (typeof b.cue === 'string') b.cue_trigger = b.cue.trim() ? cueTriggerOf(b.cue) : null
  return b
}

export const MCP_TOOLS = [
  // ============ reminders ============
  {
    name: 'reminders_list', widget: 'reminders',
    description: 'List tasks/reminders. Optionally filter to one reminder group (a task’s first label) and include completed tasks. Dates are ISO strings; null due_date = no date.',
    inputSchema: obj({ group: { type: 'string', maxLength: 100 }, include_done: { type: 'boolean' }, limit: S.limit }),
    async handler({ sub }, args) {
      let tasks = await allTasks(sub)
      if (!args.include_done) tasks = tasks.filter((t) => !t.done)
      if (args.group) tasks = tasks.filter((t) => labelGroup(t) === args.group)
      sortTasks(tasks)
      return { tasks: tasks.slice(0, clampLimit(args.limit, 100)).map(brief) }
    },
  },
  {
    name: 'reminders_capture', widget: 'reminders',
    description: 'Capture a task from ONE natural-language line, like the app’s quick-add: dates/times ("friday 2pm", "tomorrow"), priority ("!1".."!5"), a group label ("*work"), an if-then cue ("-> after lunch"). Lands in the inbox unless project_id is given. Returns the created task and what was parsed.',
    inputSchema: obj({ text: { type: 'string', minLength: 1, maxLength: 1000 }, project_id: { type: 'integer', minimum: 1 } }, ['text']),
    async handler({ sub }, args) {
      const p = parseQuickAdd(args.text)
      const body = {
        title: p.title || args.text,
        priority: p.priority || 0,
        ...(p.due_date ? { due_date: p.due_date } : {}),
        ...(p.labels?.length ? { labels: p.labels } : {}),
        ...(p.cue ? { cue: p.cue, cue_trigger: p.cue_trigger || cueTriggerOf(p.cue) } : {}),
      }
      const task = await createTaskCore(sub, args.project_id ?? await inboxProjectId(sub), body)
      return { task: brief(task), parsed: { title: body.title, due_date: p.due_date || null, priority: p.priority || 0, labels: p.labels || [], cue: p.cue || null } }
    },
  },
  {
    name: 'reminders_create', widget: 'reminders',
    description: 'Create a task with explicit fields (use reminders_capture for natural language). due_date is ISO; labels[0] doubles as the reminder group.',
    inputSchema: obj({ ...TASK_FIELDS, project_id: { type: 'integer', minimum: 1 } }, ['title']),
    async handler({ sub }, args) {
      const task = await createTaskCore(sub, args.project_id ?? await inboxProjectId(sub), taskBody(args))
      return { task: brief(task) }
    },
  },
  {
    name: 'reminders_update', widget: 'reminders',
    description: 'Update any fields of a task by id (from reminders_list / upcoming_agenda / triage_queue). Set due_date to "" to clear it; set done to complete/uncomplete (recurring tasks advance instead of completing).',
    inputSchema: obj({ task_id: S.taskId, ...TASK_FIELDS, due_date: { type: 'string', maxLength: 40 }, done: { type: 'boolean' } }, ['task_id']),
    async handler({ sub }, args) {
      const { task_id, ...rest } = args
      const body = taskBody(rest)
      if (rest.due_date !== undefined) body.due_date = rest.due_date
      if (rest.done !== undefined) body.done = rest.done
      const task = await patchTaskCore(sub, task_id, body)
      return { task: brief(task) }
    },
  },
  {
    name: 'reminders_complete', widget: 'reminders',
    description: 'Complete (or un-complete with done=false) a task by id. A recurring task advances to its next occurrence and logs the habit day.',
    inputSchema: obj({ task_id: S.taskId, done: { type: 'boolean' } }, ['task_id']),
    async handler({ sub }, args) {
      const task = await patchTaskCore(sub, args.task_id, { done: args.done !== false })
      return { task: brief(task) }
    },
  },
  {
    name: 'reminders_delete', widget: 'reminders',
    description: 'Permanently delete a task by id (cannot be undone — prefer reminders_complete unless the task is junk).',
    inputSchema: obj({ task_id: S.taskId }, ['task_id']),
    async handler({ sub }, args) { return deleteTaskCore(sub, args.task_id) },
  },
  {
    name: 'reminders_groups_list', widget: 'reminders',
    description: 'List reminder groups (name, reminder count, backing calendar) and the available calendars.',
    inputSchema: obj({}),
    async handler({ sub }) { return listGroups(sub) },
  },

  // ============ upcoming ============
  {
    name: 'upcoming_agenda', widget: 'upcoming',
    description: 'The dated agenda: open tasks with real due dates, bucketed overdue / today / tomorrow / week / later (in that order), each bucket sorted by importance then due.',
    inputSchema: obj({ limit: S.limit }),
    async handler({ sub }, args) {
      const lim = clampLimit(args.limit, 100)
      const dated = selectUpcoming(await allTasks(sub)).sort(byImportanceThenDue)
      const out = {}
      for (const k of UPCOMING_ORDER) out[k] = []
      for (const t of dated) {
        const k = dueBucket(t.due_date).k
        if (out[k] && out[k].length < lim) out[k].push(brief(t))
      }
      return out
    },
  },

  // ============ calendar ============
  {
    name: 'calendar_lists', widget: 'calendar',
    description: 'List CalDAV accounts and their enabled calendars — use an account_id + list_url pair to target calendar_create_event.',
    inputSchema: obj({}),
    async handler({ sub }) {
      const accounts = []
      for (const a of await listAccounts(sub)) {
        const lists = await enabledListsForAccount(a.id)
        accounts.push({ id: a.id, name: a.name, lists: lists.map((l) => ({ url: l.url, displayName: l.display_name })) })
      }
      return { accounts }
    },
  },
  {
    name: 'calendar_events', widget: 'calendar',
    description: 'List calendar events (VEVENTs) overlapping [start, end) — ISO date-times. All-day events have YYYY-MM-DD start/end and allDay=true. Returned objectUrl/accountId target edits/deletes.',
    inputSchema: obj({ start: S.isoDate, end: S.isoDate }, ['start', 'end']),
    async handler({ sub }, args) {
      if (isNaN(new Date(args.start).getTime()) || isNaN(new Date(args.end).getTime())) throw err('start and end must be ISO dates', 400)
      return { events: await fetchEvents(sub, args.start, args.end) }
    },
  },
  {
    name: 'calendar_create_event', widget: 'calendar',
    description: 'Create a calendar event. When account_id/list_url are omitted and exactly one enabled calendar exists, it is used; otherwise call calendar_lists and pass a target. end defaults per CalDAV rules (all-day: one day).',
    inputSchema: obj({
      summary: { type: 'string', minLength: 1, maxLength: 500 },
      start: S.isoDate, end: { type: 'string', maxLength: 40 },
      all_day: { type: 'boolean' },
      account_id: { type: 'string', maxLength: 100 }, list_url: { type: 'string', maxLength: 1000 },
    }, ['summary', 'start']),
    async handler({ sub }, args) {
      if (isNaN(new Date(args.start).getTime())) throw err('invalid start date', 400)
      let accountId = args.account_id, listUrl = args.list_url
      if (!accountId || !listUrl) {
        const accs = await listAccounts(sub)
        const options = []
        for (const a of accs) for (const l of await enabledListsForAccount(a.id)) options.push({ accountId: a.id, listUrl: l.url, name: `${a.name} · ${l.display_name || l.url}` })
        if (options.length !== 1) {
          throw err('multiple calendars available — pass account_id and list_url (see calendar_lists): ' + options.map((o) => o.name).join('; '), 400)
        }
        accountId = options[0].accountId; listUrl = options[0].listUrl
      }
      const acc = await getAccount(sub, accountId)
      if (!acc) throw err('unknown account_id', 404)
      const event = await createEvent(acc, { listUrl, summary: args.summary, start: args.start, end: args.end, allDay: !!args.all_day })
      invalidateUserEventCache(sub)
      return { ok: true, event }
    },
  },
  {
    name: 'calendar_update_event', widget: 'calendar',
    description: 'Update an event (target = account_id + object_url from calendar_events). Only provided fields change; end="" clears the end.',
    inputSchema: obj({
      account_id: { type: 'string', maxLength: 100 }, object_url: { type: 'string', maxLength: 1000 },
      summary: { type: 'string', maxLength: 500 }, start: { type: 'string', maxLength: 40 }, end: { type: 'string', maxLength: 40 }, all_day: { type: 'boolean' },
    }, ['account_id', 'object_url']),
    async handler({ sub }, args) {
      const acc = await getAccount(sub, args.account_id)
      if (!acc) throw err('unknown account_id', 404)
      await updateEvent(acc, { objectUrl: args.object_url, summary: args.summary, start: args.start, end: args.end, allDay: args.all_day })
      invalidateUserEventCache(sub)
      return { ok: true }
    },
  },
  {
    name: 'calendar_delete_event', widget: 'calendar',
    description: 'Delete an event (target = account_id + object_url from calendar_events). Cannot be undone.',
    inputSchema: obj({ account_id: { type: 'string', maxLength: 100 }, object_url: { type: 'string', maxLength: 1000 } }, ['account_id', 'object_url']),
    async handler({ sub }, args) {
      const acc = await getAccount(sub, args.account_id)
      if (!acc) throw err('unknown account_id', 404)
      await deleteEvent(acc, { objectUrl: args.object_url })
      invalidateUserEventCache(sub)
      return { ok: true }
    },
  },

  // ============ notes ============
  {
    name: 'notes_list', widget: 'notes',
    description: 'List Markdown notes (path, title, folder, tags, pinned, updated — no bodies). Paths target notes_read/notes_update.',
    inputSchema: obj({ limit: S.limit }),
    async handler({ sub }, args) {
      const list = await notes.listNotes(sub)
      if (list === null) throw err('notes are not configured — pick a notes folder in Settings first', 409)
      return { notes: list.slice(0, clampLimit(args.limit, 200)) }
    },
  },
  {
    name: 'notes_search', widget: 'notes',
    description: 'Full-text search across note bodies and titles; returns matches with snippets.',
    inputSchema: obj({ query: { type: 'string', minLength: 1, maxLength: 500 }, limit: S.limit }, ['query']),
    async handler({ sub }, args) { return { results: notes.searchNotes(sub, args.query, clampLimit(args.limit, 30, 50)) } },
  },
  {
    name: 'notes_read', widget: 'notes',
    description: 'Read one note by path: full Markdown body, tags, etag (pass the etag back to notes_update to detect conflicts).',
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 1000 } }, ['path']),
    async handler({ sub }, args) { return notes.getNote(sub, args.path) },
  },
  {
    name: 'notes_create', widget: 'notes',
    description: 'Create a note (optionally in a folder, with an initial body and tags). Returns the new note incl. its path.',
    inputSchema: obj({ title: { type: 'string', minLength: 1, maxLength: 300 }, folder: { type: 'string', maxLength: 500 }, body: { type: 'string', maxLength: 100000 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 20 } }, ['title']),
    async handler({ sub }, args) {
      const n = await notes.createNote(sub, { folder: args.folder || '', title: args.title })
      if (args.body || args.tags) return notes.saveNote(sub, n.path, { body: args.body || '', etag: n.etag, tags: args.tags })
      return n
    },
  },
  {
    name: 'notes_update', widget: 'notes',
    description: 'Replace a note’s body (and optionally tags). Pass the etag from notes_read — a mismatch means someone else edited it (409).',
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 1000 }, body: { type: 'string', maxLength: 500000 }, etag: { type: 'string', maxLength: 200 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 20 } }, ['path', 'body']),
    async handler({ sub }, args) { return notes.saveNote(sub, args.path, { body: args.body, etag: args.etag, tags: args.tags }) },
  },
  {
    name: 'notes_append', widget: 'notes',
    description: 'Append text to the end of a note (conflict-safe read-modify-write) — the easy way to add to a log/inbox note.',
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 1000 }, text: { type: 'string', minLength: 1, maxLength: 100000 } }, ['path', 'text']),
    async handler({ sub }, args) {
      const n = await notes.getNote(sub, args.path)
      const body = (n.body || '').replace(/\n*$/, '\n') + args.text + '\n'
      return notes.saveNote(sub, args.path, { body, etag: n.etag, tags: n.tags })
    },
  },
  {
    name: 'notes_backlinks', widget: 'notes',
    description: 'Notes that [[wikilink]] to the given note (path + surrounding context).',
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 1000 } }, ['path']),
    async handler({ sub }, args) { return { backlinks: notes.backlinksFor(sub, args.path) } },
  },
  {
    name: 'notes_trash', widget: 'notes',
    description: 'Move a note to the trash (recoverable in the app; there is deliberately no hard delete over MCP).',
    inputSchema: obj({ path: { type: 'string', minLength: 1, maxLength: 1000 } }, ['path']),
    async handler({ sub }, args) { return notes.trashNote(sub, args.path) },
  },

  // ============ review ============
  {
    name: 'review_stats', widget: 'review',
    description: 'Completion stats: this week vs last week (with delta), 7-day trend, 30-day total, streaks. (The weekly-review prompt state is device-local and not included.)',
    inputSchema: obj({}),
    async handler({ sub }) {
      const stats = computeReview(await allTasks(sub), new Date(), null)
      delete stats.promptDue // derived from device-local "last reviewed" — meaningless here
      return stats
    },
  },

  // ============ cues ============
  {
    name: 'cues_list', widget: 'cues',
    description: 'Open tasks that have an if-then cue ("after lunch → review inbox"), with their cue text and trigger.',
    inputSchema: obj({ limit: S.limit }),
    async handler({ sub }, args) {
      const cued = selectCued(await allTasks(sub))
      return { tasks: cued.slice(0, clampLimit(args.limit, 100)).map((t) => ({ ...brief(t), cue_trigger: t.cue_trigger || null })) }
    },
  },
  {
    name: 'cues_set', widget: 'cues',
    description: 'Set or clear (cue="") a task’s if-then cue; the trigger kind (after/location/time) is derived from the text.',
    inputSchema: obj({ task_id: S.taskId, cue: { type: 'string', maxLength: 500 } }, ['task_id', 'cue']),
    async handler({ sub }, args) {
      const cue = args.cue.trim()
      const task = await patchTaskCore(sub, args.task_id, { cue, cue_trigger: cue ? cueTriggerOf(cue) : null })
      return { task: brief(task) }
    },
  },

  // ============ triage ============
  {
    name: 'triage_queue', widget: 'triage',
    description: 'Open tasks still needing a triage decision (no time estimate or no real date), sorted by importance then due. Decide with triage_set.',
    inputSchema: obj({ limit: S.limit }),
    async handler({ sub }, args) {
      const q = openTasks(await allTasks(sub)).filter(needsTriage).sort(byImportanceThenDue)
      return { count: q.length, tasks: q.slice(0, clampLimit(args.limit, 25)).map(brief) }
    },
  },
  {
    name: 'triage_matrix', widget: 'triage',
    description: 'Open tasks grouped into the Eisenhower matrix: q1 urgent+important, q2 important, q3 urgent, q4 neither.',
    inputSchema: obj({}),
    async handler({ sub }) {
      const g = groupEisenhower(openTasks(await allTasks(sub)))
      const out = {}
      for (const k of Object.keys(g)) out[k] = (g[k] || []).map(brief)
      return out
    },
  },
  {
    name: 'triage_set', widget: 'triage',
    description: 'Make prioritization decisions on a task: mark it important (the Prioritize matrix’s importance axis), set a due_date (ISO — its urgency), time_estimate (minutes), priority 0-5. Estimate + a real date removes it from the triage queue.',
    inputSchema: obj({ task_id: S.taskId, important: S.important, time_estimate: { type: 'integer', minimum: 0, maximum: 6000 }, due_date: { type: 'string', maxLength: 40 }, priority: S.priority }, ['task_id']),
    async handler({ sub }, args) {
      const { task_id, ...patch } = args
      if (Object.keys(patch).length === 0) throw err('nothing to set — pass important, time_estimate, due_date and/or priority', 400)
      const task = await patchTaskCore(sub, task_id, patch)
      return { task: brief(task) }
    },
  },

  // ============ daily ============
  {
    name: 'daily_get_plan', widget: 'daily',
    description: 'Today’s plan (or another date’s): the picked task ids, hydrated with the tasks. date defaults to the server-local day — pass the user’s local YYYY-MM-DD when known.',
    inputSchema: obj({ date: S.date }),
    async handler({ sub }, args) {
      const plan = await getPlan(sub, planDate(args.date))
      const byId = new Map((await allTasks(sub)).map((t) => [t.id, t]))
      return { ...plan, tasks: plan.ids.map((id) => byId.get(id)).filter(Boolean).map(brief) }
    },
  },
  {
    name: 'daily_set_plan', widget: 'daily',
    description: 'Replace the day’s plan with the given task ids (order preserved). Prefer daily_plan_add/remove for single changes.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' }, maxItems: 100 }, date: S.date }, ['ids']),
    async handler({ sub }, args) { return setPlan(sub, planDate(args.date), args.ids) },
  },
  {
    name: 'daily_plan_add', widget: 'daily',
    description: 'Add one task (by id) to the day’s plan. Idempotent.',
    inputSchema: obj({ task_id: S.taskId, date: S.date }, ['task_id']),
    async handler({ sub }, args) {
      // Validate the id references a real task so the plan can't fill with junk.
      const exists = (await allTasks(sub)).some((t) => t.id === args.task_id)
      if (!exists) throw err('unknown task_id', 404)
      return addToPlan(sub, planDate(args.date), args.task_id)
    },
  },
  {
    name: 'daily_plan_remove', widget: 'daily',
    description: 'Remove one task (by id) from the day’s plan. Idempotent.',
    inputSchema: obj({ task_id: S.taskId, date: S.date }, ['task_id']),
    async handler({ sub }, args) { return removeFromPlan(sub, planDate(args.date), args.task_id) },
  },
  {
    name: 'daily_suggestions', widget: 'daily',
    description: 'What the Daily Plan widget would suggest for today: overdue/due-today first, then stalled tasks, then tasks already triaged for this week — minus what’s already planned.',
    inputSchema: obj({ limit: S.limit, date: S.date }),
    async handler({ sub }, args) {
      const tasks = await allTasks(sub)
      const open = openTasks(tasks)
      const planned = new Set((await getPlan(sub, planDate(args.date))).ids)
      const seen = new Set()
      const out = []
      const add = (t) => { if (t && !planned.has(t.id) && !seen.has(t.id)) { seen.add(t.id); out.push(t) } }
      open.filter((t) => isRealDate(t.due_date) && ['overdue', 'today'].includes(dueBucket(t.due_date).k)).sort(byImportanceThenDue).forEach(add)
      selectStalled(tasks).slice().sort(byImportanceThenDue).forEach(add)
      selectTriagedThisWeek(tasks).slice().sort(byImportanceThenDue).forEach(add)
      return { suggestions: out.slice(0, clampLimit(args.limit, 10, 50)).map(brief) }
    },
  },

  // ============ focus ============
  {
    name: 'focus_next', widget: 'focus',
    description: 'What to work on now: due-soon tasks by importance, then the rest by priority — with today’s planned tasks first (the Focus widget’s ranking).',
    inputSchema: obj({ count: { type: 'integer', minimum: 1, maximum: 25 } }),
    async handler({ sub }, args) {
      const open = openTasks(await allTasks(sub))
      const soon = open.filter((t) => isRealDate(t.due_date) && ['overdue', 'today'].includes(dueBucket(t.due_date).k)).sort(byImportanceThenDue)
      const soonSet = new Set(soon)
      const rest = open.filter((t) => !soonSet.has(t)).sort((a, b) => (b.priority || 0) - (a.priority || 0))
      const planIds = (await getPlan(sub, todayYmd())).ids
      const ranked = orderPlanFirst([...soon, ...rest], planIds)
      const planSet = new Set(planIds)
      return { tasks: ranked.slice(0, clampLimit(args.count, 1, 25)).map((t) => ({ ...brief(t), from_plan: planSet.has(t.id) })) }
    },
  },
]

export const TOOLS_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]))

// The widget types that expose MCP tools, straight from the manifest (Settings
// and the /mcp filter share this).
export const MCP_WIDGET_TYPES = WIDGET_MANIFEST.filter((m) => m.mcp).map((m) => m.type)

// The registry filtered to a user's enabled widget set — the ONLY view /mcp
// serves (a disabled widget's tools are unlisted AND uncallable).
export function toolsForWidgets(enabledSet) {
  return MCP_TOOLS.filter((t) => enabledSet.has(t.widget))
}
