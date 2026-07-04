import { useState } from 'react'
import { IconCheck, IconTrash, IconLink } from '../../widget-sdk/icons.jsx'

// Inline link editor that replaces window.prompt. Renders the form only — the
// caller wraps it in a position:relative container and owns open/close (so the
// same popover works anchored to a toolbar button or a bubble menu). Applying an
// empty URL removes the link.
// Only http(s)/mailto/tel are safe to navigate to from the live "Open link"
// anchor (mirrors what the Link extension's setLink enforces); anything else
// (e.g. javascript:) falls back to '#' so it can't execute in the app origin.
const safeHref = (u) => (/^(https?:|mailto:|tel:)/i.test(String(u || '').trim()) ? u : '#')

export default function LinkPopover({ editor, onClose }) {
  const [url, setUrl] = useState(() => editor.getAttributes('link').href || '')
  const c = () => editor.chain().focus()
  const apply = (e) => {
    e?.preventDefault()
    const u = url.trim()
    if (u) c().extendMarkRange('link').setLink({ href: u }).run()
    else c().extendMarkRange('link').unsetLink().run()
    onClose()
  }
  const isLink = editor.isActive('link')
  return (
    <form className="link-popover" onSubmit={apply} onMouseDown={(e) => e.stopPropagation()}>
      <IconLink size={14} className="link-popover-ic" />
      <input
        autoFocus className="input link-input" value={url} placeholder="https://…" aria-label="Link URL"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      />
      <button type="submit" className="iconbtn sm" title="Apply link"><IconCheck size={15} /></button>
      {isLink && (
        <>
          <a className="iconbtn sm" href={safeHref(url || editor.getAttributes('link').href)} target="_blank" rel="noopener noreferrer" title="Open link"><IconLink size={15} /></a>
          <button type="button" className="iconbtn sm" title="Remove link" onMouseDown={(e) => { e.preventDefault(); c().extendMarkRange('link').unsetLink().run(); onClose() }}><IconTrash size={15} /></button>
        </>
      )}
    </form>
  )
}
