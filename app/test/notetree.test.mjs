// Pure notes-tree logic: buildTree shape, sorting, counts, and the drag&drop
// move rules (canDropInto). Run with: node test/notetree.test.mjs
import { buildTree, folderKids, noteKids, countNotes, canDropInto } from '../client/src/notetree.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- buildTree ----
const notes = [
  { path: 'a.md', title: 'A', folder: '', updated: '2026-01-03' },
  { path: 'work/b.md', title: 'B', folder: 'work', updated: '2026-01-01' },
  { path: 'work/c.md', title: 'C', folder: 'work', updated: '2026-01-02' },
  { path: 'work/proj/d.md', title: 'D', folder: 'work/proj', updated: '2026-01-01' },
]
const tree = buildTree(['empty', 'work', 'work/proj'], notes)
ok(tree.path === '' && tree.name === '', 'root node is the unnamed root')
ok(Object.keys(tree.children).sort().join() === 'empty,work', 'top-level folders present (incl. an empty one)')
ok(tree.children.work.children.proj.path === 'work/proj', 'nested folder carries its full path')
ok(tree.notes.length === 1 && tree.notes[0].title === 'A', 'root-level note attaches to the root')
ok(tree.children.work.notes.length === 2, 'notes attach to their folder')
ok(buildTree([], [{ path: 'x.md', title: 'X', folder: 'auto/sub' }]).children.auto.children.sub.notes.length === 1,
  'a note folder missing from the folder list is created implicitly')

// ---- ordering + counts ----
ok(folderKids(tree).map((f) => f.name).join() === 'empty,work', 'folders sort by name')
ok(noteKids(tree.children.work).map((n) => n.title).join() === 'C,B', 'notes sort newest-first by updated (default)')
ok(noteKids(tree.children.work, 'title-asc').map((n) => n.title).join() === 'B,C', 'noteKids accepts a sort key (title A-Z)')
ok(countNotes(tree) === 4, 'countNotes counts the whole subtree')
ok(countNotes(tree.children.work) === 3, 'countNotes includes nested folders')
ok(countNotes(tree.children.empty) === 0, 'an empty folder counts zero')

// ---- canDropInto: notes ----
const noteDrag = { type: 'note', path: 'work/b.md', folder: 'work' }
ok(canDropInto(noteDrag, '') === true, 'note: may move to the root')
ok(canDropInto(noteDrag, 'work') === false, 'note: not into its own folder (no-op)')
ok(canDropInto(noteDrag, 'work/proj') === true, 'note: into a sibling/child folder')
ok(canDropInto({ type: 'note', path: 'a.md', folder: '' }, '') === false, 'note at root: root is a no-op')
ok(canDropInto(null, 'work') === false, 'nothing being dragged -> no drop')

// ---- canDropInto: folders ----
const folderDrag = { type: 'folder', path: 'work' }
ok(canDropInto(folderDrag, 'work') === false, 'folder: not into itself')
ok(canDropInto(folderDrag, 'work/proj') === false, 'folder: not into its own descendant')
ok(canDropInto(folderDrag, '') === false, 'folder at root: root is its parent (no-op)')
ok(canDropInto(folderDrag, 'empty') === true, 'folder: into an unrelated folder')
ok(canDropInto({ type: 'folder', path: 'work/proj' }, 'work') === false, 'nested folder: parent is a no-op')
ok(canDropInto({ type: 'folder', path: 'work/proj' }, '') === true, 'nested folder: may move out to the root')
ok(canDropInto({ type: 'folder', path: 'work' }, 'workshop') === true, 'prefix-named sibling is not a descendant')

console.log(`\nnotetree.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
