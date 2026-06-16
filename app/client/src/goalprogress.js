// Pure goal-progress computation over the shared task list. No React/browser/api
// imports so the framework-free node tests cover it directly.
//
// A goal is a VTODO flagged is_goal; child tasks link UP to it via RELATED-TO
// (task.goal === goal.uid). Progress is the share of linked children completed.
// Light by design — a flat list of goals with their direct children, not an OKR
// tree.
export function computeGoals(tasks) {
  const all = tasks || []
  const goals = all.filter((t) => t && t.is_goal && t.uid)
  const tally = new Map() // goal uid -> { total, done }
  for (const g of goals) tally.set(g.uid, { total: 0, done: 0 })
  for (const t of all) {
    if (!t || !t.goal) continue
    const e = tally.get(t.goal)
    if (!e) continue
    e.total++
    if (t.done) e.done++
  }
  return goals.map((g) => {
    const e = tally.get(g.uid) || { total: 0, done: 0 }
    return {
      uid: g.uid,
      title: g.title,
      plan: g.goal_plan || '',
      total: e.total,
      done: e.done,
      progress: e.total ? Math.round((e.done / e.total) * 100) : 0,
      task: g,
    }
  })
}

// Children of a goal (open + done), for listing under it.
export const childrenOf = (tasks, goalUid) => (tasks || []).filter((t) => t && t.goal === goalUid)
