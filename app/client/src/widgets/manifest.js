// Pure widget metadata — no React/JSX, so the framework-free node tests can
// exercise it directly (test/widget-contract.test.mjs): the widget↔app
// connection contract (`plugs`) and the layout sizing live here, decoupled from
// how a widget actually renders. registry.jsx pairs each descriptor below with
// its icon + render() to build the full entries the dashboard consumes.
//
// This split mirrors the connection layer itself: just as a widget no longer
// reaches into the app for data (it declares plugs), the *testable contract* of a
// widget no longer requires a renderer to verify.
//
// Adding a widget = one descriptor here + one renderer in registry.jsx + one
// component file. Keep the `type` identical across both halves (registry.jsx
// throws on a descriptor with no matching renderer).
//
// Descriptor shape:
//   type         stable id persisted in saved layouts — never rename or reuse
//   label        name shown in the "Add widget" menu
//   plugs        the app interfaces this widget connects to (Snap/Juju-style — see
//                connections.js / docs/widget-connections.md). The dashboard
//                auto-connects each plug to the matching app slot and passes ONLY
//                the connected interfaces' values into the widget's `ctx`. Declare
//                every interface whose ctx key you read; omit it and that key is
//                absent. Catalog: 'tasks' (ctx.tasks), 'reminder-events'
//                (ctx.events), 'projects' (ctx.projects), 'reminder-groups'
//                (ctx.groups), 'notes' (ctx.notes), 'calendar' (ctx.calendar),
//                'settings' (ctx.onOpenSettings).
//   pickGroup    optional; the "Add widget" menu opens a reminder-group submenu
//                and stores the pick as w.group (null/undefined = all groups)
//   defaultSize  optional { w, h } in grid units when first added (default 10×9)
//   minSize      optional { w, h } in grid units — the smallest a user can resize
//                this widget to (default 4×4; set to its smallest legible tier)
//   maxSize      optional { w, h } in grid units — the largest a user can resize
//                this widget to (default: no ceiling). The dashboard stamps RGL's
//                maxW/maxH; a saved item already larger is never force-shrunk.
//   aspect       optional { min, max } — the allowed width/height ratio BAND in
//                GRID CELLS (a fixed ratio is the band { min: r, max: r }). The host
//                enforces it live on resize (see Dashboard's onResize). NOTE: a grid
//                cell is ~40px wide × 30px tall, so cell-ratio ≠ on-screen pixel
//                ratio — a *visual* square is ≈ aspect { min: 0.75, max: 0.75 }, not
//                1.0. `defaultSize` (or the 10×9 fallback) must already sit inside the
//                band, since aspect is only corrected on a user resize.
//   resizable    optional boolean (default true) — false locks the widget's size
//                (no resize handles at all).
//   resizeHandles optional subset of ['s','w','e','n','sw','nw','se','ne'] — restrict
//                which edges/corners resize this widget type (overrides the grid's
//                default of all eight).
//   requires     optional capability prerequisites the host gates on, e.g.
//                ['caldav'] / ['nextcloud']. The dashboard shows a "connect it in
//                Settings" placeholder for the ones it can determine; others a
//                widget may self-handle (e.g. Notes' own "needs Nextcloud" state).
//   config       optional per-instance default config (data only); a widget reads
//                its merged config via widgetStore(instanceId). A widget type can
//                also contribute a Settings panel via `settingsPanel` (registry.jsx).
//   mcp          optional { summary, tools: ['<type>_…'] } — the MCP toolset this
//                widget exposes when the user enables it in Settings → MCP access.
//                NAMES ONLY (single source of truth for the Settings toggles and
//                the server's per-user tool filtering); the descriptions, input
//                schemas and handlers live server-side in server/mcp_tools.js,
//                and test/mcp_contract.test.mjs enforces exact parity between the
//                two. Tool names are snake_case and MUST start with `<type>_`.

export const WIDGET_MANIFEST = [
  // Every widget carries the full size contract — a min floor, a max ceiling, and
  // an aspect BAND matched to how its content is laid out — so resizing always
  // lands on a shape that reads well (cohesion). Reminder: a grid cell is ~40w×30h
  // px, so visual ratio ≈ cell ratio × 1.33 (a visual square ≈ cell aspect 0.75).
  // The effective default (defaultSize, else 10×9) must sit inside the band.
  { type: 'reminders', label: 'Reminders',     desc: 'Actionable task list — snooze, schedule, complete', plugs: ['tasks', 'reminder-events', 'projects', 'reminder-groups'], requires: ['caldav'], pickGroup: true, minSize: { w: 5, h: 5 }, maxSize: { w: 26, h: 28 }, aspect: { min: 0.55, max: 1.45 },
    mcp: { summary: 'Create, list, edit, complete and delete tasks & reminders (incl. natural-language capture)', tools: ['reminders_list', 'reminders_capture', 'reminders_create', 'reminders_update', 'reminders_complete', 'reminders_delete', 'reminders_groups_list'] } }, // task list — portrait to gentle landscape, never a thin strip
  { type: 'upcoming',  label: 'Upcoming',      desc: 'Dated tasks grouped by Today / Tomorrow / This week', plugs: ['tasks', 'projects'], requires: ['caldav'], minSize: { w: 5, h: 5 }, maxSize: { w: 26, h: 28 }, aspect: { min: 0.55, max: 1.45 },
    mcp: { summary: 'Read the dated agenda, bucketed Overdue / Today / Tomorrow / This week / Later', tools: ['upcoming_agenda'] } }, // dated-task list — same shape band as reminders
  { type: 'calendar',  label: 'Calendar',      desc: 'Month / week / agenda — events + tasks, drag to reschedule', plugs: ['tasks', 'calendar'], requires: ['caldav'], minSize: { w: 5, h: 5 }, maxSize: { w: 24, h: 22 }, aspect: { min: 0.9, max: 1.4 },
    mcp: { summary: 'List calendars, and read / create / edit / delete calendar events', tools: ['calendar_lists', 'calendar_events', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event'] } }, // a month grid reads best near-square / landscape
  { type: 'notes',     label: 'Notes',         desc: 'Markdown notes with wikilinks, from your Nextcloud', plugs: ['notes', 'settings'], requires: ['nextcloud'], defaultSize: { w: 16, h: 11 }, minSize: { w: 6, h: 6 }, maxSize: { w: 32, h: 24 }, aspect: { min: 0.5, max: 2.2 },
    mcp: { summary: 'List, search, read, create, edit, append to and trash Markdown notes', tools: ['notes_list', 'notes_search', 'notes_read', 'notes_create', 'notes_update', 'notes_append', 'notes_backlinks', 'notes_trash'] } }, // wide tree+editor split OR narrow single column — keep the band loose so both modes survive
  { type: 'review',    label: 'Weekly Review', desc: 'Completions and streaks at a glance', plugs: ['tasks'], requires: ['caldav'], defaultSize: { w: 9, h: 7 }, minSize: { w: 6, h: 5 }, maxSize: { w: 18, h: 12 }, aspect: { min: 0.7, max: 1.85 },
    mcp: { summary: 'Read completion stats, trends and streaks', tools: ['review_stats'] } }, // compact stats card — wide, not a tall sliver
  { type: 'cues',      label: 'Cues (flow)',   desc: 'If-then cue canvas — chain tasks to triggers', plugs: ['tasks', 'reminder-groups'], requires: ['caldav'], pickGroup: true, defaultSize: { w: 14, h: 11 }, minSize: { w: 8, h: 7 }, maxSize: { w: 32, h: 24 }, aspect: { min: 0.65, max: 1.85 },
    mcp: { summary: 'Read cued tasks and set / clear a task’s if-then cue', tools: ['cues_list', 'cues_set'] } }, // queue + canvas board — landscape, needs room
  { type: 'triage',    label: 'Triage',        desc: 'Eat-the-frog queue + Eisenhower matrix, with XP', plugs: ['tasks'], requires: ['caldav'], defaultSize: { w: 10, h: 12 }, minSize: { w: 6, h: 8 }, maxSize: { w: 18, h: 26 }, aspect: { min: 0.45, max: 1.05 },
    mcp: { summary: 'Read the triage queue / frog / Eisenhower matrix and make triage decisions', tools: ['triage_queue', 'triage_frog', 'triage_matrix', 'triage_set'] } }, // HUD + frog + queue stack — portrait-leaning
  { type: 'daily',     label: 'Daily Plan',    desc: 'Pick 1–3 things for today; shut down at night', plugs: ['tasks', 'projects', 'daily-plan'], requires: ['caldav'], defaultSize: { w: 10, h: 11 }, minSize: { w: 6, h: 6 }, maxSize: { w: 18, h: 24 }, aspect: { min: 0.45, max: 1.05 },
    mcp: { summary: 'Read and edit today’s plan, and get plan suggestions', tools: ['daily_get_plan', 'daily_set_plan', 'daily_plan_add', 'daily_plan_remove', 'daily_suggestions'] } }, // plan/shutdown lists stack — portrait-leaning
  { type: 'focus',     label: 'Focus',         desc: 'One task and a timer — nothing else', plugs: ['tasks', 'reminder-events', 'daily-plan'], requires: ['caldav'], defaultSize: { w: 7, h: 8 }, minSize: { w: 4, h: 5 }, maxSize: { w: 12, h: 20 }, aspect: { min: 0.55, max: 1.0 },
    mcp: { summary: 'Ask what to work on now (plan-first ranking)', tools: ['focus_next'] } }, // a single-task column stays tall & narrow
]

export const WIDGET_MANIFEST_BY_TYPE = new Map(WIDGET_MANIFEST.map((m) => [m.type, m]))

// The clean default board for fresh users and "Reset layout", left to right.
export const DEFAULT_BOARD = ['reminders', 'upcoming', 'calendar']
