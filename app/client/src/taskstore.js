// A single shared source of truth for the task list. Reminders, Upcoming and the
// Calendar all read from here, so a dashboard load fetches /api/tasks ONCE (not
// once per widget), and an optimistic edit in one widget is reflected in all of
// them immediately. Consumed via useSyncExternalStore in useTasks.js, plus
// ensureLoaded() for the calendar's (non-React) event source.
import { tk } from './api.js'
import { onTasksChanged } from './tasksbus.js'

let tasks = []
let state = 'loading' // 'loading' | 'ready' | 'error'
let inflight = null
let started = false
let fetchedAt = 0 // epoch ms of the last successful refresh
// How recent a successful load must be for the first subscriber to skip its own
// refresh. Covers the gap between Dashboard's boot warm and the first widget
// mount (~200ms in practice) — the in-flight dedupe alone can't, because the
// boot fetch has usually resolved by then.
const FRESH_MS = 5000
const subscribers = new Set()

const notify = () => { for (const fn of subscribers) { try { fn() } catch { /* a dead subscriber must not break the others */ } } }

// Snapshots for useSyncExternalStore — must return a STABLE reference between
// changes, so we only ever reassign `tasks`/`state` when they actually change.
export const getTasks = () => tasks
export const getState = () => state

// Fetch the whole list once; concurrent callers share the single in-flight request.
export function refresh() {
  if (inflight) return inflight
  inflight = (async () => {
    if (state !== 'ready') { state = 'loading'; notify() }
    try {
      const all = await tk('/tasks?per_page=250')
      tasks = Array.isArray(all) ? all : []
      state = 'ready'
      fetchedAt = Date.now()
    } catch { state = 'error' }
    finally { inflight = null }
    notify()
    return tasks
  })()
  return inflight
}

// For non-subscribing readers (the calendar event source): ensure the list is
// loaded, then hand it back.
export async function ensureLoaded() {
  if (state === 'ready') return tasks
  return refresh()
}

// ---- optimistic helpers: mutate the shared list, then notify every widget ----
export function patchTask(id, p) { tasks = tasks.map((t) => (t.id === id ? { ...t, ...p } : t)); notify() }
export function removeTask(id) { tasks = tasks.filter((t) => t.id !== id); notify() }
export function replaceTasks(next) { tasks = Array.isArray(next) ? next : []; notify() }
// Optimistic insert of a freshly-created task so it shows in every widget
// immediately, instead of vanishing until the reconcile refetch lands. No-ops
// on a missing id or a dupe (the debounced refresh will reconcile shape).
export function insertTask(t) {
  if (!t || t.id == null || tasks.some((x) => x.id === t.id)) return
  tasks = [...tasks, t]; notify()
}

let busTimer = null
export function subscribe(fn) {
  subscribers.add(fn)
  if (!started) {
    started = true
    // Any task mutation anywhere reloads the shared list (debounced), so the
    // store reconciles optimistic edits with server truth — the same contract
    // the per-widget hooks used to have, now centralized.
    onTasksChanged(() => { clearTimeout(busTimer); busTimer = setTimeout(refresh, 250) })
    // Skip the mount-time duplicate /api/tasks when the boot warm already
    // delivered a fresh list; a stale or failed load still refetches.
    if (state !== 'ready' || Date.now() - fetchedAt > FRESH_MS) refresh()
  }
  return () => subscribers.delete(fn)
}
