import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { notesApi } from './api.js'
import { IconSpinner } from './icons.jsx'

const ExcalidrawModal = lazy(() => import('./ExcalidrawModal.jsx'))

const RES_PREFIX = '/api/notes/resources/'
// A drawing is an image whose file is "<id>.excalidraw.png" (its editable scene
// lives next to it as "<id>.excalidraw"). Portable: other tools just see a PNG.
const isDrawing = (src) => /\.excalidraw\.png(\?|$)/.test(src || '')
const drawingId = (src) => { const m = /([^/]+)\.excalidraw\.png/.exec(src || ''); return m ? m[1] : null }
// On disk, image/link refs are relative (_resources/…). The editor needs a
// loadable URL; we rewrite at the boundary so the stored markdown stays portable.
const toDisplay = (md) => String(md || '').replace(/\]\(_resources\//g, '](' + RES_PREFIX)
const toDisk = (md) => String(md || '').replace(/\]\(\/api\/notes\/resources\/([^)?\s]+)(\?[^)\s]*)?\)/g, '](_resources/$1)')

// Live WYSIWYG editor that reads/writes GitHub-flavored Markdown (notes stay
// plain .md on disk). Supports inserting + re-editing Excalidraw drawings.
export default function NoteRichEditor({ value, onChange }) {
  const [drawing, setDrawing] = useState(null) // null | { scene, id }
  const editorRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: 'cb' } } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } }),
      Image.configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'note-img' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: toDisplay(value),
    autofocus: 'end',
    onUpdate: ({ editor: ed }) => onChange?.(toDisk(ed.storage.markdown.getMarkdown())),
    editorProps: {
      attributes: { class: 'tiptap-content', spellcheck: 'true' },
      handleDOMEvents: {
        dblclick: (_view, event) => {
          const t = event.target
          if (t && t.tagName === 'IMG' && isDrawing(t.getAttribute('src'))) { openForEdit(t.getAttribute('src')); return true }
          return false
        },
      },
    },
  })
  editorRef.current = editor

  useEffect(() => {
    if (!editor || value == null) return
    if (toDisk(editor.storage.markdown.getMarkdown()) !== value) editor.commands.setContent(toDisplay(value), false)
  }, [value, editor])

  const openForEdit = async (src) => {
    const id = drawingId(src)
    if (!id) return
    let scene = null
    try { const r = await fetch(RES_PREFIX + encodeURIComponent(id + '.excalidraw')); if (r.ok) scene = await r.text() } catch { /* fall back to a fresh canvas */ }
    setDrawing({ scene, id })
  }
  const newDrawing = () => setDrawing({ scene: null, id: null })

  const onDrawingSave = async ({ json, png }) => {
    const ed = editorRef.current
    const id = drawing.id || crypto.randomUUID()
    await notesApi.uploadResource(id + '.excalidraw', new Blob([json], { type: 'application/octet-stream' }), 'application/octet-stream')
    await notesApi.uploadResource(id + '.excalidraw.png', png, 'image/png')
    const src = RES_PREFIX + id + '.excalidraw.png'
    if (drawing.id) {
      // edit: find the existing node by id and refresh its preview (cache-bust)
      let pos = null
      ed.state.doc.descendants((node, p) => { if (node.type.name === 'image' && drawingId(node.attrs.src) === drawing.id) { pos = p; return false } return true })
      if (pos != null) ed.chain().focus().command(({ tr }) => { tr.setNodeAttribute(pos, 'src', src + '?v=' + Date.now()); return true }).run()
    } else {
      ed.chain().focus().setImage({ src, alt: 'drawing' }).run()
    }
    setDrawing(null)
  }

  return (
    <div className="tiptap-wrap">
      <Toolbar editor={editor} onDraw={newDrawing} />
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
  if (!editor) return null
  const c = () => editor.chain().focus()
  const Btn = ({ active, on, label, title }) => (
    <button type="button" className={`tiptap-tb-btn${active ? ' on' : ''}`} title={title} aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); on() }}>{label}</button>
  )
  const link = () => {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('Link URL', prev)
    if (url === null) return
    if (url === '') c().unsetLink().run()
    else c().extendMarkRange('link').setLink({ href: url }).run()
  }
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
      <Btn active={editor.isActive('link')} on={link} label="↗" title="Link" />
      <span className="tiptap-tb-sep" />
      <Btn active={false} on={onDraw} label="✏️" title="Insert drawing (double-click a drawing to edit)" />
    </div>
  )
}
