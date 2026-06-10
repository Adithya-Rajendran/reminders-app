import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { ResizableImage } from './NoteImage.jsx'
import { RES_PREFIX, sceneNameFor, toDisplay, toDisk, EXT } from './notepaths.js'
import { notesApi } from './api.js'
import { IconSpinner } from './icons.jsx'

const ExcalidrawModal = lazy(() => import('./ExcalidrawModal.jsx'))

// Live WYSIWYG editor that reads/writes GitHub-flavored Markdown (notes stay
// plain .md on disk). Supports inserting + re-editing Excalidraw drawings.
export default function NoteRichEditor({ value, onChange }) {
  const [drawing, setDrawing] = useState(null) // null | { scene, id, src }
  const editorRef = useRef(null)
  const editRef = useRef(null)

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
        codeBlock: { HTMLAttributes: { class: 'cb' } },
        // Link ships inside StarterKit since tiptap v3 — configure it here.
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } },
      }),
      ResizableImage.configure({ inline: false, allowBase64: false, onEdit: (src) => editRef.current?.(src) }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: toDisplay(value),
    autofocus: 'end',
    // tiptap v3 stops re-rendering on every transaction by default; the toolbar
    // reads editor.isActive(...) on render, so opt back in to live active states.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => onChange?.(toDisk(ed.storage.markdown.getMarkdown())),
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
    if (!editor || value == null) return
    if (toDisk(editor.storage.markdown.getMarkdown()) !== value) editor.commands.setContent(toDisplay(value), { emitUpdate: false })
  }, [value, editor])

  const newDrawing = () => setDrawing({ scene: null, id: null, src: null })

  // Paste an image straight into the note → upload to _resources → embed.
  const uploadAndInsert = async (file) => {
    const ed = editorRef.current
    if (!ed) return
    const name = crypto.randomUUID() + '.' + (EXT[file.type] || 'png')
    try { await notesApi.uploadResource(name, file, file.type); ed.chain().focus().setImage({ src: RES_PREFIX + name, alt: file.name || 'image' }).run() } catch { /* ignore */ }
  }

  const onDrawingSave = async ({ json, png }) => {
    const ed = editorRef.current
    const id = drawing.id || crypto.randomUUID()
    await notesApi.uploadResource(id + '.excalidraw', new Blob([json], { type: 'application/octet-stream' }), 'application/octet-stream')
    await notesApi.uploadResource(id + '.excalidraw.png', png, 'image/png')
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
