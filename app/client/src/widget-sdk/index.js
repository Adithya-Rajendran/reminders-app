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
export { SkeletonRows, EmptyState, ErrorState, UndoBar } from './ui/parts.jsx'
export { default as TaskRow } from './ui/TaskRow.jsx'
export { default as DateTimePicker } from './ui/DateTimePicker.jsx'
export { default as GroupPicker, GroupList } from './ui/GroupPicker.jsx'

// Notes-widget building blocks (the heavy editor stack) live on a separate entry
// — import them from '../widget-sdk/notes' — so this barrel stays light.

// ---- hooks ----
export { WidgetSizeContext, useWidgetSize, useElementSize } from '../useWidgetSize.js'
export { usePopover } from '../usePopover.js'

// ---- size classification (pure) ----
export { atLeastW, atMostW, atLeastH, atMostH, DEFAULT_WIDGET_SIZE } from '../widgetsize.js'

// ---- icons ----
export * from '../icons.jsx'

// ---- pure domain helpers ----
export * from '../taskviews.js'
export { ZERO_DATE, isRealDate, parseQuickAdd, dueChip, timeLabel, absDate, PRIORITIES, pdotClass } from '../tasklib.js'
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
export { widgetStore } from './widgetStore.js'
