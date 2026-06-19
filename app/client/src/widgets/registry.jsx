import { lazy } from 'react'
import { IconBell, IconClock, IconCalendar, IconNote, IconChart, IconCue, IconFrog } from '../widget-sdk'
import { NotesFolderPanel } from '../widget-sdk/panels'
import { WIDGET_MANIFEST, DEFAULT_BOARD } from './manifest.js'

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

// The render/view half of each widget, keyed by the same `type` as its pure
// descriptor in manifest.js. Splitting the JSX (icon + render here) from the pure
// metadata (manifest) is deliberate: it keeps the widget↔app connection contract
// node-testable without a renderer (test/widget-contract.test.mjs).
//
//   icon    icon for the "Add widget" menu and the widget frame (from icons.jsx)
//   render  (w, ctx) => element. `w` is the saved widget instance (per-instance
//           options like w.group live on it); `ctx` holds EXACTLY the interfaces
//           the descriptor's `plugs` connected to — nothing more (least privilege).
//   title   optional (w) => string for the frame header (default: the label)
//   settingsPanel  optional component the widget type contributes to the Settings
//           modal (rendered there with { accounts }); see widget-sdk/panels.js
//   lifecycle  optional { onMount(w, ctx), onUnmount(w) } run once per widget
//           instance by the dashboard (forward-looking; no widget uses it yet)
const RENDERERS = {
  reminders: {
    icon: IconBell,
    title: (w) => w.group || 'Reminders', // a group-locked widget shows the group name
    render: (w, ctx) => (
      <RemindersWidget tasks={ctx.tasks} events={ctx.events} projects={ctx.projects} groups={ctx.groups} group={w.group || null} instanceId={w.i} />
    ),
  },
  upcoming: { icon: IconClock, render: (w, ctx) => <UpcomingWidget tasks={ctx.tasks} projects={ctx.projects} instanceId={w.i} /> },
  calendar: { icon: IconCalendar, render: (w, ctx) => <CalendarWidget tasks={ctx.tasks} calendar={ctx.calendar} /> },
  notes: {
    icon: IconNote,
    // The Notes widget contributes its folder-config panel to the Settings modal.
    settingsPanel: NotesFolderPanel,
    render: (w, ctx) => <NotesWidget notes={ctx.notes} onOpenSettings={ctx.onOpenSettings} instanceId={w.i} />,
  },
  review: { icon: IconChart, render: (w, ctx) => <ReviewWidget tasks={ctx.tasks} instanceId={w.i} /> },
  cues: { icon: IconCue, render: (w, ctx) => <CuesWidget tasks={ctx.tasks} groups={ctx.groups} group={w.group || ''} /> },
  frog: { icon: IconFrog, render: (w, ctx) => <FrogWidget tasks={ctx.tasks} instanceId={w.i} /> },
}

// Each manifest descriptor + its renderer = a full widget entry, in menu order.
// Throw loudly (dev/load time) if a descriptor has no renderer — the two halves
// must stay in sync, and a missing renderer would otherwise blank that widget.
export const WIDGETS = WIDGET_MANIFEST.map((m) => {
  const r = RENDERERS[m.type]
  if (!r || typeof r.render !== 'function') throw new Error(`widget "${m.type}" has a manifest descriptor but no renderer (see widgets/registry.jsx)`)
  return { ...m, ...r }
})

export const WIDGET_TYPES = new Map(WIDGETS.map((w) => [w.type, w]))

export { DEFAULT_BOARD }
