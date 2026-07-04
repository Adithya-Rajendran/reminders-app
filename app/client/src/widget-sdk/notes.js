// Heavy app-level Notes editor stack (NoteEditor pulls tiptap; the trash/context
// pieces ride along), re-exported on a SEPARATE SDK entry so the main barrel —
// and therefore every other widget and their component tests — never evaluates
// this stack. The Notes widget imports these from '../widget-sdk/notes'.
export { default as NoteEditor } from '../host/NoteEditor.jsx'
export { default as NoteContextMenu } from '../host/NoteContextMenu.jsx'
export { default as TrashView } from '../host/TrashView.jsx'
export { default as PromptModal } from '../host/PromptModal.jsx'
