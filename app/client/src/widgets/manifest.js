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
//   requires     optional capability prerequisites the host gates on, e.g.
//                ['caldav'] / ['nextcloud']. The dashboard shows a "connect it in
//                Settings" placeholder for the ones it can determine; others a
//                widget may self-handle (e.g. Notes' own "needs Nextcloud" state).
//   config       optional per-instance default config (data only); a widget reads
//                its merged config via widgetStore(instanceId). A widget type can
//                also contribute a Settings panel via `settingsPanel` (registry.jsx).

export const WIDGET_MANIFEST = [
  { type: 'reminders', label: 'Reminders',     plugs: ['tasks', 'reminder-events', 'projects', 'reminder-groups'], requires: ['caldav'], pickGroup: true, minSize: { w: 5, h: 5 } },
  { type: 'upcoming',  label: 'Upcoming',      plugs: ['tasks', 'projects'], requires: ['caldav'] },
  { type: 'calendar',  label: 'Calendar',      plugs: ['tasks', 'calendar'], requires: ['caldav'], minSize: { w: 5, h: 5 } },
  { type: 'notes',     label: 'Notes',         plugs: ['notes', 'settings'], requires: ['nextcloud'], minSize: { w: 6, h: 6 } },
  { type: 'review',    label: 'Weekly Review', plugs: ['tasks'], requires: ['caldav'], defaultSize: { w: 8, h: 8 } },
  { type: 'cues',      label: 'Cues (flow)',   plugs: ['tasks', 'reminder-groups'], requires: ['caldav'], pickGroup: true, defaultSize: { w: 14, h: 11 }, minSize: { w: 6, h: 6 } },
  { type: 'frog',      label: 'Today’s Frog',  plugs: ['tasks'], requires: ['caldav'], defaultSize: { w: 8, h: 7 } },
  { type: 'daily',     label: 'Daily Plan',    plugs: ['tasks', 'projects'], requires: ['caldav'], defaultSize: { w: 10, h: 11 }, minSize: { w: 6, h: 6 } },
  { type: 'focus',     label: 'Focus',         plugs: ['tasks', 'reminder-events'], requires: ['caldav'], defaultSize: { w: 7, h: 8 }, minSize: { w: 4, h: 5 } },
]

export const WIDGET_MANIFEST_BY_TYPE = new Map(WIDGET_MANIFEST.map((m) => [m.type, m]))

// The clean default board for fresh users and "Reset layout", left to right.
export const DEFAULT_BOARD = ['reminders', 'upcoming', 'calendar']
