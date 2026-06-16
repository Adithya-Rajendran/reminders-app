import { useState } from 'react'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { usePopover } from '../usePopover.js'
import { CALLOUT_TYPES, calloutLabel } from './callout.js'

// Node view for a callout: a non-editable type chip (click to change type) above
// the editable body. The colour comes from the `callout-<type>` class.
export default function CalloutView({ node, updateAttributes }) {
  const [open, setOpen] = useState(false)
  const ref = usePopover(open, setOpen)
  const type = node.attrs.type || 'note'
  return (
    <NodeViewWrapper className={`callout callout-${type}`}>
      <div className="callout-head" contentEditable={false} ref={ref}>
        <button type="button" className="callout-type" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          {calloutLabel(type)}
        </button>
        {open && (
          <div className="callout-menu menu" role="menu">
            {CALLOUT_TYPES.map((t) => (
              <button key={t} type="button" className={`menu-item${t === type ? ' active' : ''}`} role="menuitem"
                onClick={() => { updateAttributes({ type: t }); setOpen(false) }}>
                {calloutLabel(t)}
              </button>
            ))}
          </div>
        )}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  )
}
