// Recently-opened notes ring buffer (device-local; the widget persists it via
// storage.js loadJson/saveJson). Pure so it's node-tested.

// Move/insert `entry` ({ path, title }) to the front, de-duped by path, capped.
export function pushRecent(list, entry, cap = 8) {
  const path = entry && entry.path
  if (!path) return (list || []).slice(0, cap)
  const e = { path, title: entry.title || '' }
  return [e, ...(list || []).filter((x) => x.path !== path)].slice(0, cap)
}

// Drop recent entries whose note no longer exists (existsPaths: Set of paths).
export const pruneRecent = (list, existsPaths) => (list || []).filter((x) => existsPaths.has(x.path))
