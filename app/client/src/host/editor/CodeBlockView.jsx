import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'

// Curated language list for the per-block picker. lowlight `common` highlights
// far more; anything not listed still round-trips its fence label, just without
// a dropdown entry (we add the current one if it's unknown).
const LANGS = ['plaintext', 'bash', 'c', 'cpp', 'css', 'diff', 'go', 'java', 'javascript', 'json', 'markdown', 'python', 'rust', 'sql', 'typescript', 'xml', 'yaml']

// Node view for a fenced code block: a small language `<select>` floating in the
// corner over the highlighted code. The code text lives in NodeViewContent so
// lowlight's decorations still render the syntax colors.
export default function CodeBlockView({ node, updateAttributes }) {
  const lang = node.attrs.language || 'plaintext'
  const langs = LANGS.includes(lang) ? LANGS : [lang, ...LANGS]
  return (
    <NodeViewWrapper className="cb-wrap">
      <select
        className="hover-reveal cb-lang" contentEditable={false} value={lang}
        onChange={(e) => updateAttributes({ language: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()} aria-label="Code language"
      >
        {langs.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <pre><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
  )
}
