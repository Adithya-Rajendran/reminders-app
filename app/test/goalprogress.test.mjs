// Pure goal-progress computation. Run with: node test/goalprogress.test.mjs
import { computeGoals, childrenOf } from '../client/src/goalprogress.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const tasks = [
  { id: 'g1', uid: 'G1', is_goal: true, title: 'Ship v2' },
  { id: 'g2', uid: 'G2', is_goal: true, title: 'Learn Rust' },
  { id: 'g3', uid: '', is_goal: true, title: 'No-uid goal' },     // excluded (no uid)
  { id: 't1', goal: 'G1', done: false },
  { id: 't2', goal: 'G1', done: true },
  { id: 't3', goal: 'G2', done: true },
  { id: 't4', done: false },                                       // unlinked
  { id: 't5', goal: 'GX', done: true },                            // links to unknown goal
]

const goals = computeGoals(tasks)
ok(goals.length === 2, 'only goals with a uid are returned')
const g1 = goals.find((g) => g.uid === 'G1')
const g2 = goals.find((g) => g.uid === 'G2')
ok(g1.total === 2 && g1.done === 1 && g1.progress === 50, 'G1: 1 of 2 done -> 50%')
ok(g2.total === 1 && g2.done === 1 && g2.progress === 100, 'G2: 1 of 1 done -> 100%')

// goal with no children -> 0% (no division by zero)
{
  const only = computeGoals([{ uid: 'E', is_goal: true, title: 'Empty' }])
  ok(only[0].total === 0 && only[0].progress === 0, 'childless goal -> 0% (no NaN)')
}

// unlinked tasks and links to unknown goals never inflate totals
ok(g1.total + g2.total === 3, 'unlinked task + unknown-goal link are not counted')

// childrenOf
ok(childrenOf(tasks, 'G1').map((t) => t.id).join() === 't1,t2', 'childrenOf returns a goal’s linked tasks')
ok(childrenOf(tasks, 'none').length === 0, 'childrenOf unknown goal -> empty')

// plan + title surfaced
{
  const g = computeGoals([{ uid: 'P', is_goal: true, title: 'T', goal_plan: 'Output goal. Obstacle: time.' }])[0]
  ok(g.title === 'T' && g.plan === 'Output goal. Obstacle: time.', 'goal carries title + plan')
}

console.log(`\ngoalprogress.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
