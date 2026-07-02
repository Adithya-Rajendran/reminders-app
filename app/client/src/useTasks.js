import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'

// Shared task-list behaviour, parameterized by the `tasks` capability the app
// delivers through the connection layer (ctx.tasks) — so a widget never imports
// the store/buses directly. Derives a widget's view from the single shared store
// via a memoized `selector`, plus optimistic priority/due edits, a recurring-aware
// completion with Undo, and delete with a re-create Undo. Mutations hit the SHARED
// store (sibling widgets update instantly) and broadcast on the tasks bus (so the
// store reconciles with the server).
export function useTaskList(tasks, selector) {
  const {
    subscribe, getTasks, getState, refresh,
    patchTask: storePatch, removeTask: storeRemove, replaceTasks,
    update, create, del, attachLabels, emitChanged, isRealDate,
  } = tasks
  const all = useSyncExternalStore(subscribe, getTasks)
  const state = useSyncExternalStore(subscribe, getState)
  const view = useMemo(() => selector(all), [all, selector])

  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)

  const load = useCallback(() => refresh(), [refresh])

  const showUndo = useCallback((label, fn) => {
    clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    // No announce() here: the UndoBar this feeds is a NoticeBar, which already
    // announces its label on mount — announcing both would double-speak.
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }, [])
  const dismissUndo = useCallback(() => { clearTimeout(undoTimer.current); setUndo(null) }, [])

  // A caught mutation failure means we already reverted the optimistic change, but
  // that revert is invisible — surface a brief, non-actionable status on the same
  // undo-bar channel (no undo fn) so the user knows the save didn't reach the server.
  const showSaveError = useCallback(() => showUndo('Couldn’t save — check your server', null), [showUndo])

  const onSetPriority = useCallback((task, priority) => {
    storePatch(task.id, { priority })
    update(task.id, { priority }).then(emitChanged).catch(() => { refresh(); showSaveError() })
  }, [storePatch, update, emitChanged, refresh, showSaveError])

  // Generic optimistic field patch (cue_trigger / dread / time_estimate / …):
  // patch the shared store immediately, then persist; on failure, refetch to
  // reconcile. Keeps widgets from each needing a bespoke setter per field.
  const onPatch = useCallback((task, patch) => {
    storePatch(task.id, patch)
    update(task.id, patch).then(emitChanged).catch(() => { refresh(); showSaveError() })
  }, [storePatch, update, emitChanged, refresh, showSaveError])

  // Set/clear the implementation-intention cue ("after X -> do Y").
  const onSetCue = useCallback((task, cue) => {
    storePatch(task.id, { cue })
    update(task.id, { cue }).then(emitChanged).catch(() => { refresh(); showSaveError() })
  }, [storePatch, update, emitChanged, refresh, showSaveError])

  // Set due date + (optionally) a reminder at the same instant, from the picker.
  // due_date is an ISO string or ZERO_DATE to clear; reminder is an ISO or null.
  const onSchedule = useCallback((task, { due_date, reminder }) => {
    const reminders = reminder ? [{ reminder }] : []
    storePatch(task.id, { due_date, reminders })
    update(task.id, { due_date, reminders }).then(emitChanged).catch(() => { refresh(); showSaveError() })
  }, [storePatch, update, emitChanged, refresh, showSaveError])

  // completedLabel lets a widget substitute a richer message on the SAME undo
  // bar ("Done ✓ — next: …") instead of layering a second announce() over the
  // bar's own — one announcement per completion.
  const onToggle = useCallback(async (task, { completedLabel } = {}) => {
    if (task.done) { storePatch(task.id, { done: false }); update(task.id, { done: false }).then(emitChanged).catch(() => { refresh(); showSaveError() }); return }
    const snapshot = getTasks()
    storeRemove(task.id) // optimistic remove with exit animation handled in CSS
    try {
      const r = await update(task.id, { done: true })
      emitChanged()
      if (r && r.done === false) {
        // Recurring: the store keeps the task open and (if it can) bumps the due
        // date. If the date didn't actually advance (e.g. no due date set), it can
        // never complete — say so honestly instead of a misleading "Rescheduled".
        const advanced = isRealDate(r.due_date) && (!isRealDate(task.due_date) || new Date(r.due_date) > new Date(task.due_date))
        showUndo(advanced ? 'Rescheduled ↻' : 'Recurring — set a due date to complete', null)
        refresh()
      } else {
        showUndo(completedLabel || 'Completed', async () => { await update(task.id, { done: false }).catch(() => {}); emitChanged(); refresh() })
      }
    } catch { replaceTasks(snapshot); showSaveError() }
  }, [storePatch, storeRemove, replaceTasks, update, emitChanged, isRealDate, refresh, getTasks, showUndo, showSaveError])

  // Delete is permanent, so Undo re-creates the task (best effort: core fields +
  // reminders + labels). The restored task gets a new id.
  const onDelete = useCallback(async (task) => {
    const snapshot = getTasks()
    storeRemove(task.id)
    try {
      await del(task.id)
      emitChanged()
      showUndo('Deleted', async () => {
        try {
          const created = await create(task.project_id || 1, {
            title: task.title,
            description: task.description || '',
            priority: task.priority || 0,
            ...(isRealDate(task.due_date) ? { due_date: task.due_date } : {}),
            ...(task.repeat_after ? { repeat_after: task.repeat_after, repeat_mode: task.repeat_mode || 0 } : {}),
          })
          if (created?.id) {
            if (Array.isArray(task.reminders) && task.reminders.length) await update(created.id, { reminders: task.reminders }).catch(() => {})
            if (Array.isArray(task.labels) && task.labels.length) await attachLabels(created.id, task.labels.map((l) => l.title)).catch(() => {})
          }
        } catch { /* best-effort restore */ }
        emitChanged(); refresh()
      })
    } catch { replaceTasks(snapshot); refresh(); showSaveError() }
  }, [storeRemove, replaceTasks, del, create, update, attachLabels, emitChanged, isRealDate, refresh, getTasks, showUndo, showSaveError])

  return { tasks: view, state, load, onToggle, onDelete, onSchedule, onSetPriority, onSetCue, onPatch, undo, dismissUndo }
}
