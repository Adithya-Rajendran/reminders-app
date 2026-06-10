// Pure tree + move logic for the notes sidebar — no React/DOM so the
// framework-free node tests can exercise it (test/notetree.test.mjs).
import { parentFolder } from './notepaths.js'

// Build a nested tree of folders (incl. empty) with each note attached to its folder.
export function buildTree(folderPaths, notes) {
  const root = { name: '', path: '', children: {}, notes: [] }
  const ensure = (fp) => {
    let node = root, acc = ''
    for (const seg of String(fp).split('/').filter(Boolean)) {
      acc = acc ? acc + '/' + seg : seg
      node.children[seg] = node.children[seg] || { name: seg, path: acc, children: {}, notes: [] }
      node = node.children[seg]
    }
    return node
  }
  for (const fp of folderPaths) ensure(fp)
  for (const n of notes) ensure(n.folder || '').notes.push(n)
  return root
}

export const folderKids = (node) => Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name))
export const noteKids = (node) => (node.notes || []).slice().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))
export const countNotes = (node) => (node.notes || []).length + folderKids(node).reduce((s, c) => s + countNotes(c), 0)

// Whether `drag` ({ type: 'note'|'folder', path, folder? }) may drop into the
// folder `target` ('' = root): a note may go anywhere but its own folder; a
// folder anywhere but itself, its own descendants, or its current parent.
export function canDropInto(drag, target) {
  if (!drag) return false
  if (drag.type === 'note') return (drag.folder || '') !== target
  return target !== drag.path && !target.startsWith(drag.path + '/') && parentFolder(drag.path) !== target
}
