// Tiny localStorage helpers for a Set<string> persisted as a JSON array.
// Never throw (private mode / blocked storage): reads fall back to empty,
// writes are best-effort.
export const loadStringSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
export const saveStringSet = (key, set) => {
  try { localStorage.setItem(key, JSON.stringify([...set])) } catch { /* ignore */ }
}
