// Recently-used reminder groups, per browser. "Used" = a reminder was just added
// to the group. Most-recent first, capped — drives the default rows in GroupPicker.
const KEY = 'reminders-recent-groups'
const MAX = 3

export function recentGroups() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(a) ? a.filter(Boolean).slice(0, MAX) : []
  } catch { return [] }
}

export function pushRecentGroup(name) {
  const g = String(name || '').trim()
  if (!g) return
  try {
    const cur = recentGroups().filter((x) => x !== g)
    localStorage.setItem(KEY, JSON.stringify([g, ...cur].slice(0, MAX)))
  } catch { /* ignore */ }
}
