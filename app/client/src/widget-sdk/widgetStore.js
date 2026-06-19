import { loadJson, saveJson, loadStringSet, saveStringSet } from '../storage.js'

// Per-widget-instance device-local storage. UI state (collapsed sections, the
// pinned frog, recent notes, sort) is namespaced under the widget instance id, so
// two instances of the same widget type — e.g. a Reminders widget per board — keep
// independent state instead of clobbering one shared global key.
//
// Reads fall back ONCE to the pre-namespacing global key, so a user's existing
// state survives the upgrade; the first scoped write takes over from then on.
// (For string sets the fallback fires while the scoped set is empty — an
// acceptable one-time migration nicety, not a durable behaviour.)
export function widgetStore(instanceId) {
  const ns = (key) => `w:${instanceId || 'default'}:${key}`
  return {
    loadJson(key, fallback) {
      const scoped = loadJson(ns(key), undefined)
      return scoped !== undefined ? scoped : loadJson(key, fallback)
    },
    saveJson(key, val) { saveJson(ns(key), val) },
    loadStringSet(key) {
      const scoped = loadStringSet(ns(key))
      return scoped.size ? scoped : loadStringSet(key)
    },
    saveStringSet(key, set) { saveStringSet(ns(key), set) },
  }
}
