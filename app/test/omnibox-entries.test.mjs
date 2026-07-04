// buildEntries (client/src/omnibox.js): the pure flattening of every palette source
// into one typed entry list — source coverage, ordering, ids/tags/keys, the
// Go-to-vs-Add nav verb, and the conditional Clear-filter row. The side-effecting
// icon/run fields are injected, so this stays a plain-node test.
// Run with: node test/omnibox-entries.test.mjs
import { buildEntries } from '../client/src/omnibox.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Recorders for the injected run actions — each pushes its argument so a test can
// assert an entry's run() is wired to the right action with the right payload.
function mkActions(extra = {}) {
  const calls = { scope: [], goTo: [], add: [], reveal: [], open: [], newNote: 0 }
  return {
    calls,
    newNoteIcon: 'PLUS_ICON', clearFilterIcon: 'X_ICON',
    dueChip: (d) => (d === 'DUE' ? { label: 'Overdue' } : null),
    onNewNote: () => { calls.newNote++ },
    onGoTo: (w) => calls.goTo.push(w),
    onAdd: (type) => calls.add.push(type),
    onScope: (f) => calls.scope.push(f),
    onRevealTask: (id) => calls.reveal.push(id),
    onOpenNote: (p) => calls.open.push(p),
    ...extra,
  }
}
const byId = (entries, id) => entries.find((e) => e.id === id)

// --- Commands: the built-in New note leads, host commands follow with alias keys ---
{
  const a = mkActions()
  const entries = buildEntries({ commands: [{ id: 'logout', label: 'Log out', hint: 'End session', aliases: ['signout'], run() {}, priority: 0 }] }, a)
  const first = entries[0]
  ok(first.id === 'new-note' && first.kind === 'command' && first.priority === 1, 'the built-in "New note" command is first, priority 1')
  ok(first.icon === 'PLUS_ICON', 'New note carries the injected icon (icons are injected, not imported)')
  first.run(); ok(a.calls.newNote === 1, 'New note run() calls the injected onNewNote')
  const logout = byId(entries, 'logout')
  ok(logout && logout.keys.join(',') === 'Log out,signout', 'a host command keeps its label + aliases as match keys')
}

// --- Nav: on-board surfaces get "Go to", absent ones "Add"; run wiring differs ---
{
  const a = mkActions()
  const entries = buildEntries({ board: [{ i: 'w-ov', type: 'overview' }] }, a)
  const goOv = byId(entries, 'nav-overview')
  ok(goOv && goOv.tag === 'Go to' && /^Go to /.test(goOv.title), 'a surface ON the board gets a "Go to" nav entry')
  ok(goOv.keys.includes('overview') || goOv.keys.some((k) => /overview/i.test(k)), 'nav keys include the surface label/aliases (so "triage"→Prioritize still resolves)')
  goOv.run(); ok(a.calls.goTo.length === 1 && a.calls.goTo[0].i === 'w-ov', 'a "Go to" run() flashes the on-board widget via onGoTo(here)')
  // A surface NOT on the board (inbox isn't in the board above) → "Add".
  const addInbox = byId(entries, 'nav-inbox')
  ok(addInbox && addInbox.tag === 'Add', 'a surface NOT on the board gets an "Add" nav entry')
  addInbox.run(); ok(a.calls.add.length === 1 && a.calls.add[0] === 'inbox', 'an "Add" run() adds the type via onAdd(type)')
}

// --- Areas & Contexts: ids are NOT double-prefixed; run scopes the board ---
{
  const a = mkActions()
  const entries = buildEntries({
    areas: [{ id: 'area-abc', name: 'Acme', kind: 'project' }, { id: 'area-def', name: 'Home', kind: 'area' }],
    contexts: ['work'],
  }, a)
  const acme = byId(entries, 'area-abc')
  ok(acme && acme.kind === 'area' && acme.tag === 'Project', 'a project area yields an entry tagged "Project"')
  // Regression guard for the PR A fix: the row id is the area id itself, NOT "area-"+id.
  ok(acme.id === 'area-abc' && !byId(entries, 'area-area-abc'), 'an area entry id is a.id (no doubled "area-" prefix)')
  acme.run(); ok(a.calls.scope.length === 1 && a.calls.scope[0].areaId === 'area-abc' && a.calls.scope[0].context === null, 'selecting an area scopes the board to it via onScope')
  const home = byId(entries, 'area-def')
  ok(home.tag === 'Area', 'an ongoing area yields an entry tagged "Area"')
  const ctx = byId(entries, 'ctx-work')
  ok(ctx && ctx.title === '@work' && ctx.keys.includes('@work') && ctx.keys.includes('work'), 'a context entry titles "@work" and matches with/without the @')
  ctx.run(); ok(a.calls.scope[1].context === 'work' && a.calls.scope[1].areaId === null, 'selecting a context scopes the board to it')
}

// --- Clear-filter row: only when a scope is active; wired to clear ---
{
  ok(!byId(buildEntries({ filter: null }, mkActions()), 'clear-filter'), 'no Clear-filter row when no filter is active')
  ok(!byId(buildEntries({ filter: { areaId: null, context: null } }, mkActions()), 'clear-filter'), 'no Clear-filter row when the filter is empty')
  const a = mkActions()
  const clear = byId(buildEntries({ filter: { context: 'work' } }, a), 'clear-filter')
  ok(clear && clear.icon === 'X_ICON', 'a Clear-filter row appears when a scope is active')
  clear.run(); ok(a.calls.scope[0].areaId === null && a.calls.scope[0].context === null, 'Clear-filter run() clears both dimensions')
}

// --- Tasks: open only, dueChip drives the subtitle, run reveals ---
{
  const a = mkActions()
  const entries = buildEntries({
    tasks: [
      { id: 7, title: 'Ship it', due_date: 'DUE' },
      { id: 8, title: 'Done thing', done: true },      // completed → excluded
      { id: null, title: 'No id' },                    // no id → excluded
    ],
  }, a)
  const t = byId(entries, 'task-7')
  ok(t && t.title === 'Ship it' && t.subtitle === 'Overdue', 'an open task uses the injected dueChip label as its subtitle')
  ok(!byId(entries, 'task-8'), 'a completed task is excluded (would flood content search)')
  ok(entries.filter((e) => e.kind === 'task').length === 1, 'a task with no id is skipped')
  t.run(); ok(a.calls.reveal[0] === 7, 'a task run() reveals it via onRevealTask(id)')
  // A task with no due chip falls back to the generic "Task" subtitle.
  const t2 = byId(buildEntries({ tasks: [{ id: 9, title: 'Someday' }] }, mkActions()), 'task-9')
  ok(t2.subtitle === 'Task', 'a task with no due chip gets the generic "Task" subtitle')
}

// --- Notes ---
{
  const a = mkActions()
  const note = byId(buildEntries({ notes: [{ path: 'a/b.md', title: 'Spec', folder: 'a' }] }, a), 'note-a/b.md')
  ok(note && note.title === 'Spec' && note.folder === 'a', 'a note becomes a note-<path> entry carrying its folder')
  note.run(); ok(a.calls.open[0] === 'a/b.md', 'a note run() opens it via onOpenNote(path)')
}

// --- Empty/omitted sources never throw (every source defaults to []) ---
{
  const entries = buildEntries({}, mkActions())
  ok(Array.isArray(entries) && entries[0].id === 'new-note', 'with no sources, only the built-in New note command is produced')
}

console.log(`omnibox-entries: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
