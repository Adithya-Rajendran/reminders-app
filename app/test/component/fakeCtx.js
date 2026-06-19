import { isRealDate } from '../../client/src/tasklib.js'

// An in-memory stand-in for the ctx.tasks capability the app injects, for
// component/hook tests. Backs a tiny observable store + records the server-side
// mutation calls so a test can assert "the widget asked the app to update task N"
// without a real fetch. `_set`/`_state` drive it from the test.
export function fakeTasks(initial = [], state = 'ready') {
  let tasks = initial
  let st = state
  const subs = new Set()
  const notify = () => { for (const fn of subs) fn() }
  const calls = { update: [], create: [], del: [], attachLabels: [], emitChanged: 0 }
  return {
    calls,
    _set(next) { tasks = next; notify() },
    _state(s) { st = s; notify() },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    getTasks: () => tasks,
    getState: () => st,
    refresh: () => Promise.resolve(tasks),
    ensureLoaded: () => Promise.resolve(tasks),
    patchTask(id, p) { tasks = tasks.map((t) => (t.id === id ? { ...t, ...p } : t)); notify() },
    removeTask(id) { tasks = tasks.filter((t) => t.id !== id); notify() },
    replaceTasks(next) { tasks = next; notify() },
    update(id, patch) { calls.update.push([id, patch]); return Promise.resolve({ id, ...patch }) },
    create(projectId, body) { calls.create.push([projectId, body]); return Promise.resolve({ id: 999, ...body }) },
    del(id) { calls.del.push(id); return Promise.resolve({}) },
    attachLabels(id, names) { calls.attachLabels.push([id, names]); return Promise.resolve() },
    emitChanged() { calls.emitChanged++ },
    onChanged() { return () => {} },
    isRealDate,
  }
}

// Stand-in for ctx.groups.
export function fakeGroups(names = []) {
  return {
    fetch: () => Promise.resolve({ groups: names.map((name) => ({ name })) }),
    recent: () => [],
    pushRecent() {},
    onNewGroup() {},
  }
}
