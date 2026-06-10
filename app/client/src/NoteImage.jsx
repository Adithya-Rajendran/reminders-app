import { useRef } from 'react'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { widthOf, withWidth, isDrawing } from './notepaths.js'

// A resizable image node. Width is carried in the URL fragment (#w640) so it
// round-trips through plain Markdown — `![](_resources/x.png#w640)` is still a
// normal image to any other tool (the fragment is ignored when the image loads).
// A drawing image (`.excalidraw.png`) gets a hover "Edit" button + double-click to
// re-open the Excalidraw editor — handled here in the node view so a real click
// reliably fires (ProseMirror's handleDOMEvents can miss node-view dblclicks).

function ImageView({ node, updateAttributes, selected, extension }) {
  const imgRef = useRef(null)
  const src = node.attrs.src
  const width = widthOf(src)
  const onEdit = extension.options.onEdit
  const drawing = isDrawing(src)
  const edit = (e) => { e.preventDefault(); e.stopPropagation(); onEdit?.(src) }
  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = imgRef.current ? imgRef.current.offsetWidth : 320
    const onMove = (ev) => updateAttributes({ src: withWidth(node.attrs.src, Math.max(80, Math.min(1600, Math.round(startW + (ev.clientX - startX))))) })
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  return (
    <NodeViewWrapper className={`note-img-wrap${selected ? ' sel' : ''}${drawing ? ' is-drawing' : ''}`} style={{ width: width ? width + 'px' : undefined }}>
      <img ref={imgRef} src={src} alt={node.attrs.alt || ''} className="note-img" draggable={false} onDoubleClick={onEdit ? edit : undefined} />
      {drawing && onEdit && (
        <button type="button" className="img-edit" onMouseDown={(e) => e.preventDefault()} onClick={edit} contentEditable={false} title="Edit drawing">✏️ Edit</button>
      )}
      <span className="img-resize" onMouseDown={startResize} title="Drag to resize" contentEditable={false} />
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addOptions() { return { ...this.parent?.(), onEdit: null } },
  addNodeView() { return ReactNodeViewRenderer(ImageView) },
})
