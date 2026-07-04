import { useState } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { usePopover } from '../../widget-sdk/usePopover.js'
import LinkPopover from './LinkPopover.jsx'

// Stable plugin props — passing a fresh function/object each render makes
// BubbleMenu re-create its ProseMirror plugin on every transaction, which loops.
const BUBBLE_OPTIONS = { placement: 'top' }
const bubbleShouldShow = ({ editor, state }) => {
  const { selection } = state
  if (selection.empty || selection.node) return false // no empty / node (image) selections
  return editor.isEditable && !editor.isActive('codeBlock')
}

// Selection toolbar (Notion/Affine-style) over highlighted text: quick formatting
// plus a proper link popover. Hidden inside code blocks and for node selections.
export default function EditorBubbleMenu({ editor }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const linkRef = usePopover(linkOpen, setLinkOpen)
  if (!editor) return null
  const c = () => editor.chain().focus()
  const B = ({ active, on, label, title }) => (
    <button type="button" className={`bm-btn${active ? ' on' : ''}`} title={title} aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); on() }}>{label}</button>
  )
  return (
    <BubbleMenu editor={editor} className="bubble-menu" shouldShow={bubbleShouldShow} options={BUBBLE_OPTIONS}>
      <B active={editor.isActive('bold')} on={() => c().toggleBold().run()} label={<b>B</b>} title="Bold" />
      <B active={editor.isActive('italic')} on={() => c().toggleItalic().run()} label={<i>I</i>} title="Italic" />
      <B active={editor.isActive('strike')} on={() => c().toggleStrike().run()} label={<s>S</s>} title="Strikethrough" />
      <B active={editor.isActive('code')} on={() => c().toggleCode().run()} label="‹›" title="Inline code" />
      <span className="bm-sep" />
      <span className="bm-link-wrap" ref={linkRef}>
        <button type="button" className={`bm-btn${editor.isActive('link') ? ' on' : ''}`} title="Link" aria-label="Link"
          onMouseDown={(e) => { e.preventDefault(); setLinkOpen((o) => !o) }}>↗</button>
        {linkOpen && <LinkPopover editor={editor} onClose={() => setLinkOpen(false)} />}
      </span>
    </BubbleMenu>
  )
}
