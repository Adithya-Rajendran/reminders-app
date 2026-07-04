// The widget SDK — the ONLY module a widget may import (besides `react` and its
// own sibling files). It re-exports the shared widget UI, hooks, pure domain
// helpers, the task-list hook, and icons. Application state/data reaches a widget
// through ctx capabilities (see connections.js + Dashboard), never through this
// barrel — so this surface stays free of api/store/bus imports.
//
// The ESLint widget-boundary rule (eslint.config.js) enforces that widgets/**
// import only `react`, `./` siblings, and `../widget-sdk`. Heavy app-level pieces
// the Notes widget needs (the editor stack) live at src root and are re-exported
// here so the widget itself stays decoupled.

// ---- shared widget UI ----
export { SkeletonRows, EmptyState, ErrorState, ReconnectBanner, UndoBar, NoticeBar, QuickAddPreview } from './ui/parts.jsx'
export { announce, LiveAnnouncer } from './ui/announcer.jsx'
export { useMenuKeyNav } from './ui/useMenuKeyNav.js'
export { emitNotice, onNotice } from '../notices.js'
export { default as TaskRow, EstimateControl, fmtEst } from './ui/TaskRow.jsx'
export { PriorityDot } from './ui/PriorityDot.jsx'
export { default as DateTimePicker } from './ui/DateTimePicker.jsx'
export { default as GroupPicker, GroupList } from './ui/GroupPicker.jsx'
export { default as AreaPicker } from './ui/AreaPicker.jsx'
export { default as ContextPicker } from './ui/ContextPicker.jsx'
export { default as ImportanceControl } from './ui/ImportanceControl.jsx'

// Notes-widget building blocks (the heavy editor stack) live on a separate entry
// — import them from '../widget-sdk/notes' — so this barrel stays light.

// ---- hooks ----
export { WidgetSizeContext, useWidgetSize, useElementSize } from '../useWidgetSize.js'
export { usePopover } from '../usePopover.js'
export { useModalRef } from '../useModalRef.js'
export { useOrganizerFilter } from './ui/useOrganizerFilter.js'

// ---- size classification (pure) ----
export { atLeastW, atMostW, atLeastH, atMostH, DEFAULT_WIDGET_SIZE } from '../widgetsize.js'

// ---- icons ----
export * from '../icons.jsx'

// ---- pure domain helpers ----
export * from '../taskviews.js'
export * from '../notiftier.js'
export { ZERO_DATE, isRealDate, parseQuickAdd, cueTriggerOf, dueChip, timeLabel, absDate, isTimedDue, PRIORITIES, pdotClass } from '../tasklib.js'
export { tasksToCalendarEvents } from '../calevents.js'
export { NODE_W, NODE_H, CONTENT_W, CONTENT_H, edgePath, toContent, nodeOut, nodeIn, edgeBetween, dropBase, dragTo, uidFromPoint } from '../flowgeom.js'
export * from '../habitstats.js'
export * from '../reviewstats.js'
export * from '../notetree.js'
export * from '../notesort.js'
export * from '../notepaths.js'
export * from '../noterecent.js'

// ---- task-list hook ----
// P1 signature is useTaskList(selector); P2 rebinds it to useTaskList(ctx.tasks,
// selector) once tasks are delivered through the connection layer.
export { useTaskList } from '../useTasks.js'

// ---- device-local storage ----
// widgetStore(instanceId) is the per-instance surface widgets should use; the raw
// helpers remain for non-instance-scoped state (e.g. a global app preference).
export { loadJson, saveJson, loadStringSet, saveStringSet } from '../storage.js'
export { widgetStore, appSharedStore } from './widgetStore.js'
