import { lazy } from 'react'
import { IconBell, IconClock, IconCalendar, IconNote, IconChart, IconCue, IconFrog } from '../icons.jsx'

// Widgets are lazy: each becomes its own build chunk, fetched the first time it
// appears on a board. Heavy dependencies (FullCalendar, the notes editor) stay
// out of the initial bundle, and the bundle stays flat as widgets accumulate.
// The widget frame in Dashboard.jsx provides the <Suspense> boundary.
const UpcomingWidget = lazy(() => import('./UpcomingWidget.jsx'))
const RemindersWidget = lazy(() => import('./RemindersWidget.jsx'))
const CalendarWidget = lazy(() => import('./CalendarWidget.jsx'))
const NotesWidget = lazy(() => import('./NotesWidget.jsx'))
const ReviewWidget = lazy(() => import('./ReviewWidget.jsx'))
const CuesWidget = lazy(() => import('./CuesWidget.jsx'))
const FrogWidget = lazy(() => import('./FrogWidget.jsx'))

// Every dashboard widget is declared here; the Dashboard itself is generic.
// Adding a widget = one component file in this folder + one entry below.
// See docs/adding-a-widget.md and docs/widget-connections.md for the walkthrough.
//
// Entry shape:
//   type         stable id persisted in saved layouts — never rename or reuse
//   label        name shown in the "Add widget" menu
//   icon         icon for the menu and the widget frame (from icons.jsx)
//   plugs        the app interfaces this widget connects to (Snap/Juju-style — see
//                connections.js / docs/widget-connections.md). The dashboard
//                auto-connects each plug to the matching app slot and passes ONLY
//                the connected interfaces' values into `ctx`. Declare every
//                interface whose ctx key you read; omit it and that key is absent.
//                Catalog: 'tasks' (shared task store, ambient — no ctx key),
//                'reminder-events' (ctx.events), 'projects' (ctx.projects),
//                'reminder-groups' (ctx.onNewGroup), 'settings' (ctx.onOpenSettings).
//   render       (w, ctx) => element. `w` is the saved widget instance (custom
//                options like w.group live on it); `ctx` holds exactly the
//                interfaces declared in `plugs` (nothing more — least privilege).
//   title        optional (w) => string for the frame header (default: label)
//   pickGroup    optional; the "Add widget" menu opens a reminder-group submenu
//                and stores the pick as w.group (null/undefined = all groups)
//   defaultSize  optional { w, h } in grid units when first added (default 10×9
//                — about a third of the board wide at the lg breakpoint)
//   minSize      optional { w, h } in grid units — the smallest a user can resize
//                this widget to (Apple-style floor, so its content never breaks).
//                Default 4×4 (see DEFAULT_MIN_SIZE in Dashboard.jsx). Set this to
//                the widget's smallest legible tier.

export const WIDGETS = [
  {
    type: 'reminders',
    label: 'Reminders',
    icon: IconBell,
    plugs: ['tasks', 'reminder-events', 'projects', 'reminder-groups'],
    pickGroup: true,
    minSize: { w: 5, h: 5 },
    title: (w) => w.group || 'Reminders', // a group-locked widget shows the group name
    render: (w, ctx) => (
      <RemindersWidget events={ctx.events} projects={ctx.projects} group={w.group || null} onNewGroup={ctx.onNewGroup} />
    ),
  },
  {
    type: 'upcoming',
    label: 'Upcoming',
    icon: IconClock,
    plugs: ['tasks'],
    render: () => <UpcomingWidget />,
  },
  {
    type: 'calendar',
    label: 'Calendar',
    icon: IconCalendar,
    plugs: ['tasks'],
    minSize: { w: 5, h: 5 },
    render: () => <CalendarWidget />,
  },
  {
    type: 'notes',
    label: 'Notes',
    icon: IconNote,
    plugs: ['settings'],
    minSize: { w: 6, h: 6 },
    render: (_w, ctx) => <NotesWidget onOpenSettings={ctx.onOpenSettings} />,
  },
  {
    type: 'review',
    label: 'Weekly Review',
    icon: IconChart,
    plugs: ['tasks'],
    defaultSize: { w: 8, h: 8 },
    render: () => <ReviewWidget />,
  },
  {
    type: 'cues',
    label: 'Cues (flow)',
    icon: IconCue,
    plugs: ['tasks', 'reminder-groups'],
    pickGroup: true,
    defaultSize: { w: 14, h: 11 },
    minSize: { w: 6, h: 6 },
    render: (w, ctx) => <CuesWidget group={w.group || ''} onNewGroup={ctx.onNewGroup} />,
  },
  {
    type: 'frog',
    label: 'Today’s Frog',
    icon: IconFrog,
    plugs: ['tasks'],
    defaultSize: { w: 8, h: 7 },
    render: () => <FrogWidget />,
  },
]

export const WIDGET_TYPES = new Map(WIDGETS.map((w) => [w.type, w]))

// The clean default board for fresh users and "Reset layout", left to right.
export const DEFAULT_BOARD = ['reminders', 'upcoming', 'calendar']
