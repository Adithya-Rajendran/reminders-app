import React, { useRef } from 'react'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { widthOf, withWidth } from './notepaths.js'

// A resizable image node. Width is carried in the URL fragment (#w640) so it
// round-trips through plain Markdown — `![](_resources/x.png#w640)` is still a
// normal image to any other tool (the fragment is ignored when the image loads).

function ImageView({ node, updateAttributes, selected }) {
  const imgRef = useRef(null)
  const width = widthOf(node.attrs.src)
  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = imgRef.current ? imgRef.current.offsetWidth : 320
    const onMove = (ev) => updateAttributes({ src: withWidth(node.attrs.src, Math.max(80, Math.min(1600, Math.round(startW + (ev.clientX - startX))))) })
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }
  return (
    <NodeViewWrapper className={`note-img-wrap${selected ? ' sel' : ''}`} style={{ width: width ? width + 'px' : undefined }}>
      <img ref={imgRef} src={node.attrs.src} alt={node.attrs.alt || ''} className="note-img" draggable={false} />
      <span className="img-resize" onMouseDown={startResize} title="Drag to resize" contentEditable={false} />
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addNodeView() { return ReactNodeViewRenderer(ImageView) },
})
