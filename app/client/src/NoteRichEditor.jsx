import React, { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'

// Live WYSIWYG editor that reads/writes GitHub-flavored Markdown. The note's
// canonical form on disk stays plain .md; this only changes how it's edited.
// Lazy-loaded by NoteEditor so Tiptap is code-split out of the main bundle.
export default function NoteRichEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: { HTMLAttributes: { class: 'cb' } } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true, transformCopiedText: true }),
    ],
    content: value || '',
    autofocus: 'end',
    onUpdate: ({ editor: ed }) => onChange?.(ed.storage.markdown.getMarkdown()),
    editorProps: { attributes: { class: 'tiptap-content', spellcheck: 'true' } },
  })

  // Re-sync only when the markdown actually differs (e.g. switching notes),
  // never on our own edits — avoids an update loop.
  useEffect(() => {
    if (!editor || value == null) return
    if (editor.storage.markdown.getMarkdown() !== value) editor.commands.setContent(value || '', false)
  }, [value, editor])

  return (
    <div className="tiptap-wrap">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="tiptap-editor" />
    </div>
  )
}

function Toolbar({ editor }) {
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
    </div>
  )
}
