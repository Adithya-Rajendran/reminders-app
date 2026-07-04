import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import { ResizableImage } from './NoteImage.jsx'
import { CodeBlock } from './editor/CodeBlockLowlight.js'
import { MarkdownTable } from './editor/MarkdownTable.js'
import { Callout } from './editor/Callout.js'
import { SlashCommand } from './editor/SlashCommand.js'
import { Wikilink } from './editor/Wikilink.js'
import EditorBubbleMenu from './editor/EditorBubbleMenu.jsx'
import SlashMenuPopup from './editor/SlashMenuPopup.jsx'
import WikilinkMenu from './editor/WikilinkMenu.jsx'
import TableControls from './editor/TableControls.jsx'
import LinkPopover from './editor/LinkPopover.jsx'
import { usePopover } from '../widget-sdk/usePopover.js'
import { RES_PREFIX, sceneNameFor, toDisplay, toDisk, EXT } from '../domain/notepaths.js'
import { resolveWikilink } from '../domain/wikilinks.js'
import { emitOpenNote } from '../data/notesbus.js'
import { emitNotice } from '../domain/notices.js'
import { notesApi } from '../data/api.js'
import { IconSpinner } from '../widget-sdk/icons.jsx'

const ExcalidrawModal = lazy(() => import('./ExcalidrawModal.jsx'))

// Live WYSIWYG editor that reads/writes GitHub-flavored Markdown (notes stay
// plain .md on disk). Supports inserting + re-editing Excalidraw drawings.
export default function NoteRichEditor({ value, onChange, notes = [], folder = '' }) {
  const [drawing, setDrawing] = useState(null) // null | { scene, id, src }
  const editorRef = useRef(null)
  const editRef = useRef(null)
  // Latest note list + current folder for wikilink resolution/autocomplete, read
  // through refs so the once-created editor always sees fresh data.
  const notesRef = useRef(notes)
  const folderRef = useRef(folder)
  notesRef.current = notes
  folderRef.current = folder
  // Click a [[wikilink]] → open the target note, creating it (in this note's
  // folder) when it doesn't exist yet.
  const openWikilink = async (target, _alias, inFolder) => {
    const hit = resolveWikilink(target, notesRef.current, inFolder)
    if (hit) { emitOpenNote(hit.path); return }
    try { const n = await notesApi.create(inFolder || '', target); emitOpenNote(n.path) } catch { /* ignore */ }
  }
  // The markdown we last loaded/emitted — so a node-view normalization (e.g. a
  // blockquote being promoted to a callout on load) that serializes back to the
  // same markdown doesn't masquerade as an edit and trigger a spurious save.
  const lastValueRef = useRef(value)

  // Open the Excalidraw editor for an image IF it has a sibling .excalidraw scene
  // (so a real drawing is editable, a plain pasted image is not). Stable via a ref
  // so the node view + paste config always call the latest.
  const openForEdit = async (src) => {
    const sceneName = sceneNameFor(src)
    if (!sceneName) return
    try {
      const r = await fetch(RES_PREFIX + encodeURIComponent(sceneName))
      if (!r.ok) return // not a drawing (no scene) — leave a plain image alone
      const scene = await r.text()
      setDrawing({ scene, id: sceneName.replace(/\.excalidraw$/i, ''), src })
    } catch { /* ignore */ }
  }
  editRef.current = openForEdit

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Replaced by the lowlight code block below (same `codeBlock` node name,
        // so markdown fences still round-trip).
        codeBlock: false,
        // Link ships inside StarterKit since tiptap v3 — configure it here.
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } },
      }),
      CodeBlock,
      MarkdownTable.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Callout,
      SlashCommand,
      Wikilink.configure({ getNotes: () => notesRef.current || [], getFolder: () => folderRef.current || '', onOpen: openWikilink }),
      ResizableImage.configure({ inline: false, allowBase64: false, onEdit: (src) => editRef.current?.(src) }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: toDisplay(value),
    // Open at the top (cursor at start) rather than scrolled to the end.
    autofocus: 'start',
    // v3's render-phase editor creation races its own 1ms destroy-if-unmounted
    // timer against React's passive effects: if effects run late (first open,
    // busy main thread) the editor is destroyed with storage wiped while our
    // effects still hold it. Creating the editor in an effect (the v2 behavior)
    // avoids the race.
    immediatelyRender: false,
    // appendTransaction doesn't fire for the editor's initial content, so promote
    // `> [!TYPE]` blockquotes into callouts explicitly once the editor is ready.
    onCreate: ({ editor: ed }) => { ed.commands.promoteCallouts?.() },
    // tiptap v3 stops re-rendering on every transaction by default; the toolbar
    // reads editor.isActive(...) on render, so opt back in to live active states.
    shouldRerenderOnTransaction: true,
    // storage is wiped on a destroyed editor — never feed onChange from one
    // (toDisk(undefined) would save the string "undefined" as the note body).
    onUpdate: ({ editor: ed }) => {
      const md = ed.storage.markdown
      if (!md) return
      const next = toDisk(md.getMarkdown())
      if (next === lastValueRef.current) return // no real change (e.g. a load-time callout promotion)
      lastValueRef.current = next
      onChange?.(next)
    },
    editorProps: {
      attributes: { class: 'tiptap-content', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const items = event.clipboardData && event.clipboardData.items
        if (!items) return false
        for (const it of items) {
          if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { event.preventDefault(); uploadAndInsert(f); return true } }
        }
        return false
      },
      handleDOMEvents: {
        // Fallback for the editor surface; the node view handles the common case.
        dblclick: (_view, event) => {
          const t = event.target
          if (t && t.tagName === 'IMG') { editRef.current?.(t.getAttribute('src')); return true }
          return false
        },
      },
    },
  })
  editorRef.current = editor

  useEffect(() => {
    if (!editor || editor.isDestroyed || value == null) return
    // `value` echoing back our own onChange emission — don't re-set content (that
    // would fight the editor and, with the load-time callout promotion, loop).
    if (value === lastValueRef.current) return
    const md = editor.storage.markdown
    if (md && toDisk(md.getMarkdown()) !== value) {
      editor.commands.setContent(toDisplay(value), { emitUpdate: false })
      editor.commands.promoteCallouts?.()
    }
    lastValueRef.current = value
  }, [value, editor])

  const newDrawing = () => setDrawing({ scene: null, id: null, src: null })

  // Paste an image straight into the note → upload to _resources → embed.
  const uploadAndInsert = async (file) => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const name = crypto.randomUUID() + '.' + (EXT[file.type] || 'png')
    try {
      await notesApi.uploadResource(name, file, file.type)
      ed.chain().focus().setImage({ src: RES_PREFIX + name, alt: file.name || 'image' }).run()
    } catch {
      // Surface the failure through the notices bus so the widget's NoticeBar
      // shows it — the editor has no UI of its own for errors.
      emitNotice({ kind: 'error', label: 'Image upload failed' })
    }
  }

  const onDrawingSave = async ({ json, png }) => {
    const ed = editorRef.current
    // The error notice's Retry can outlive the note (notice persists after the
    // editor closes) — bail before uploading, or the resources land on the
    // server and the insert below throws on a destroyed editor.
    if (!ed || ed.isDestroyed) return
    const id = drawing.id || crypto.randomUUID()
    try {
      await notesApi.uploadResource(id + '.excalidraw', new Blob([json], { type: 'application/octet-stream' }), 'application/octet-stream')
      await notesApi.uploadResource(id + '.excalidraw.png', png, 'image/png')
    } catch {
      // Drawing save failed: notify via the bus. Keep the modal open (setDrawing
      // is NOT cleared here) so the user can retry from inside the dialog.
      emitNotice({
        kind: 'error',
        label: 'Drawing save failed',
        action: { label: 'Retry', fn: () => onDrawingSave({ json, png }) },
      })
      return
    }
    const src = RES_PREFIX + id + '.excalidraw.png'
    if (drawing.src) {
      // edit: replace the opened node's preview (cache-bust), preserving its width.
      // Match the exact node we opened so any embed format (old `<id>.png`, new
      // `<id>.excalidraw.png`) updates correctly.
      let pos = null, oldSrc = ''
      ed.state.doc.descendants((node, p) => { if (node.type.name === 'image' && node.attrs.src === drawing.src) { pos = p; oldSrc = node.attrs.src || ''; return false } return true })
      if (pos != null) {
        const frag = (/#.*$/.exec(oldSrc) || [''])[0]
        ed.chain().focus().command(({ tr }) => { tr.setNodeAttribute(pos, 'src', src + '?v=' + Date.now() + frag); return true }).run()
      }
    } else {
      ed.chain().focus().setImage({ src, alt: 'drawing' }).run()
    }
    setDrawing(null)
  }

  return (
    <div className="tiptap-wrap">
      <Toolbar editor={editor} onDraw={newDrawing} />
      <TableControls editor={editor} />
      <EditorBubbleMenu editor={editor} />
      <SlashMenuPopup />
      <WikilinkMenu />
      <EditorContent editor={editor} className="tiptap-editor" />
      {drawing && (
        <Suspense fallback={<div className="overlay"><IconSpinner size={26} /></div>}>
          <ExcalidrawModal initialScene={drawing.scene} onSave={onDrawingSave} onClose={() => setDrawing(null)} />
        </Suspense>
      )}
    </div>
  )
}

function Toolbar({ editor, onDraw }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const linkRef = usePopover(linkOpen, setLinkOpen)
  if (!editor) return null
  const c = () => editor.chain().focus()
  const Btn = ({ active, on, label, title }) => (
    <button type="button" className={`tiptap-tb-btn${active ? ' on' : ''}`} title={title} aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); on() }}>{label}</button>
  )
  return (
    <div className="tiptap-toolbar">
      <Btn active={editor.isActive('bold')} on={() => c().toggleBold().run()} label={<b>B</b>} title="Bold" />
      <Btn active={editor.isActive('italic')} on={() => c().toggleItalic().run()} label={<i>I</i>} title="Italic" />
      <Btn active={editor.isActive('strike')} on={() => c().toggleStrike().run()} label={<s>S</s>} title="Strikethrough" />
      <span className="tiptap-tb-sep" />
      <Btn active={editor.isActive('heading', { level: 1 })} on={() => c().toggleHeading({ level: 1 }).run()} label="H1" title="Heading 1" />
      <Btn active={editor.isActive('heading', { level: 2 })} on={() => c().toggleHeading({ level: 2 }).run()} label="H2" title="Heading 2" />
      <Btn active={editor.isActive('heading', { level: 3 })} on={() => c().toggleHeading({ level: 3 }).run()} label="H3" title="Heading 3" />
      <span className="tiptap-tb-sep" />
      <Btn active={editor.isActive('bulletList')} on={() => c().toggleBulletList().run()} label="•" title="Bullet list" />
      <Btn active={editor.isActive('orderedList')} on={() => c().toggleOrderedList().run()} label="1." title="Numbered list" />
      <Btn active={editor.isActive('taskList')} on={() => c().toggleTaskList().run()} label="☑" title="Checklist" />
      <span className="tiptap-tb-sep" />
      <Btn active={editor.isActive('blockquote')} on={() => c().toggleBlockquote().run()} label="❝" title="Quote" />
      <Btn active={editor.isActive('code')} on={() => c().toggleCode().run()} label="‹›" title="Inline code" />
      <Btn active={editor.isActive('codeBlock')} on={() => c().toggleCodeBlock().run()} label="{ }" title="Code block" />
      <span className="tiptap-link-wrap" ref={linkRef}>
        <button type="button" className={`tiptap-tb-btn${editor.isActive('link') ? ' on' : ''}`} title="Link" aria-label="Link"
          onMouseDown={(e) => { e.preventDefault(); setLinkOpen((o) => !o) }}>↗</button>
        {linkOpen && <LinkPopover editor={editor} onClose={() => setLinkOpen(false)} />}
      </span>
      <span className="tiptap-tb-sep" />
      <Btn active={editor.isActive('table')} on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="▦" title="Insert table" />
      <Btn active={false} on={onDraw} label="✏️" title="Insert drawing (double-click a drawing to edit)" />
    </div>
  )
}
