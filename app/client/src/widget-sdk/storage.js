// Tiny localStorage helpers for a Set<string> persisted as a JSON array.
// Never throw (private mode / blocked storage): reads fall back to empty,
// writes are best-effort.
export const loadStringSet = (key) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}
export const saveStringSet = (key, set) => {
  try { localStorage.setItem(key, JSON.stringify([...set])) } catch { /* ignore */ }
}

// Arbitrary JSON value, same never-throw contract (for the sort choice, the
// recent-notes ring buffer, panel toggles, …). Missing/blocked → `fallback`.
export const loadJson = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
}
export const saveJson = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}
