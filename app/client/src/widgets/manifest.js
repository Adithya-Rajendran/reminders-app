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

export const WIDGET_MANIFEST = [
  // Every widget carries the full size contract — a min floor, a max ceiling, and
  // an aspect BAND matched to how its content is laid out — so resizing always
  // lands on a shape that reads well (cohesion). Reminder: a grid cell is ~40w×30h
  // px, so visual ratio ≈ cell ratio × 1.33 (a visual square ≈ cell aspect 0.75).
  // The effective default (defaultSize, else 10×9) must sit inside the band.
  { type: 'reminders', label: 'Reminders',     plugs: ['tasks', 'reminder-events', 'projects', 'reminder-groups'], requires: ['caldav'], pickGroup: true, minSize: { w: 5, h: 5 }, maxSize: { w: 26, h: 28 }, aspect: { min: 0.55, max: 1.45 } }, // task list — portrait to gentle landscape, never a thin strip
  { type: 'upcoming',  label: 'Upcoming',      plugs: ['tasks', 'projects'], requires: ['caldav'], minSize: { w: 5, h: 5 }, maxSize: { w: 26, h: 28 }, aspect: { min: 0.55, max: 1.45 } }, // dated-task list — same shape band as reminders
  { type: 'calendar',  label: 'Calendar',      plugs: ['tasks', 'calendar'], requires: ['caldav'], minSize: { w: 5, h: 5 }, maxSize: { w: 24, h: 22 }, aspect: { min: 0.9, max: 1.4 } }, // a month grid reads best near-square / landscape
  { type: 'notes',     label: 'Notes',         plugs: ['notes', 'settings'], requires: ['nextcloud'], defaultSize: { w: 16, h: 11 }, minSize: { w: 6, h: 6 }, maxSize: { w: 32, h: 24 }, aspect: { min: 0.5, max: 2.2 } }, // wide tree+editor split OR narrow single column — keep the band loose so both modes survive
  { type: 'review',    label: 'Weekly Review', plugs: ['tasks'], requires: ['caldav'], defaultSize: { w: 9, h: 7 }, minSize: { w: 6, h: 5 }, maxSize: { w: 18, h: 12 }, aspect: { min: 0.7, max: 1.85 } }, // compact stats card — wide, not a tall sliver
  { type: 'cues',      label: 'Cues (flow)',   plugs: ['tasks', 'reminder-groups'], requires: ['caldav'], pickGroup: true, defaultSize: { w: 14, h: 11 }, minSize: { w: 8, h: 7 }, maxSize: { w: 32, h: 24 }, aspect: { min: 0.65, max: 1.85 } }, // queue + canvas board — landscape, needs room
  { type: 'triage',    label: 'Triage',        plugs: ['tasks'], requires: ['caldav'], defaultSize: { w: 10, h: 12 }, minSize: { w: 6, h: 8 }, maxSize: { w: 18, h: 26 }, aspect: { min: 0.45, max: 1.05 } }, // HUD + frog + queue stack — portrait-leaning
  { type: 'daily',     label: 'Daily Plan',    plugs: ['tasks', 'projects'], requires: ['caldav'], defaultSize: { w: 10, h: 11 }, minSize: { w: 6, h: 6 }, maxSize: { w: 18, h: 24 }, aspect: { min: 0.45, max: 1.05 } }, // plan/shutdown lists stack — portrait-leaning
  { type: 'focus',     label: 'Focus',         plugs: ['tasks', 'reminder-events'], requires: ['caldav'], defaultSize: { w: 7, h: 8 }, minSize: { w: 4, h: 5 }, maxSize: { w: 12, h: 20 }, aspect: { min: 0.55, max: 1.0 } }, // a single-task column stays tall & narrow
]

export const WIDGET_MANIFEST_BY_TYPE = new Map(WIDGET_MANIFEST.map((m) => [m.type, m]))

// The clean default board for fresh users and "Reset layout", left to right.
export const DEFAULT_BOARD = ['reminders', 'upcoming', 'calendar']
