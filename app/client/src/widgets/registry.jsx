import { lazy } from 'react'
import { IconBell, IconClock, IconCalendar, IconNote, IconChart, IconCue, IconTrophy, IconSun, IconTarget } from '../widget-sdk'
import { NotesFolderPanel } from '../widget-sdk/panels'
import { WIDGET_MANIFEST, DEFAULT_BOARD } from './manifest.js'

// Widgets are lazy: each becomes its own build chunk, fetched the first time it
// appears on a board. Heavy dependencies (FullCalendar, the notes editor) stay
// out of the initial bundle, and the bundle stays flat as widgets accumulate.
// The widget frame in Dashboard.jsx provides the <Suspense> boundary.
//
// The import thunks live in LOADERS (one per type) so preloadWidgets can warm a
// chunk BEFORE the saved layout arrives — lazy() reuses the same thunk, so a
// warmed import promise is picked up instead of fetched again. Without this,
// every chunk request waits behind the /api/layouts round-trip (a cold-paint
// waterfall measured at ~200ms+RTT on the deployed app).
export const LOADERS = {
  upcoming: () => import('./UpcomingWidget.jsx'),
  reminders: () => import('./RemindersWidget.jsx'),
  calendar: () => import('./CalendarWidget.jsx'),
  notes: () => import('./NotesWidget.jsx'),
  review: () => import('./ReviewWidget.jsx'),
  cues: () => import('./CuesWidget.jsx'),
  triage: () => import('./TriageWidget.jsx'),
  daily: () => import('./DailyWidget.jsx'),
  focus: () => import('./FocusWidget.jsx'),
}
// Warm the chunks for a board's widget types (best-effort; unknown types no-op).
export function preloadWidgets(types) {
  for (const t of new Set(types || [])) { try { LOADERS[t]?.() } catch { /* best-effort */ } }
}
const UpcomingWidget = lazy(LOADERS.upcoming)
const RemindersWidget = lazy(LOADERS.reminders)
const CalendarWidget = lazy(LOADERS.calendar)
const NotesWidget = lazy(LOADERS.notes)
const ReviewWidget = lazy(LOADERS.review)
const CuesWidget = lazy(LOADERS.cues)
const TriageWidget = lazy(LOADERS.triage)
const DailyWidget = lazy(LOADERS.daily)
const FocusWidget = lazy(LOADERS.focus)

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
  triage: { icon: IconTrophy, render: (w, ctx) => <TriageWidget tasks={ctx.tasks} instanceId={w.i} /> },
  daily: { icon: IconSun, render: (w, ctx) => <DailyWidget tasks={ctx.tasks} projects={ctx.projects} plan={ctx.plan} instanceId={w.i} /> },
  focus: { icon: IconTarget, render: (w, ctx) => <FocusWidget tasks={ctx.tasks} events={ctx.events} plan={ctx.plan} instanceId={w.i} /> },
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
