import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import CalloutView from './CalloutView.jsx'
import { normalizeCalloutType, calloutHeaderLine, parseCalloutHeader, stripCalloutHeader } from './callout.js'

// Obsidian-style callout block. On disk it's a blockquote whose first line is a
// `[!TYPE]` token (portable: Obsidian/Foam render it as a callout, plain readers
// see a quote). Serialize writes that form; a ProseMirror plugin promotes such
// blockquotes back to callouts on load/paste. If promotion ever misses, the
// content survives as an ordinary blockquote — no data loss (graceful degrade).
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (el) => normalizeCalloutType(el.getAttribute('data-type')),
        renderHTML: (attrs) => ({ 'data-type': normalizeCalloutType(attrs.type) }),
      },
    }
  },

  parseHTML() { return [{ tag: 'div[data-callout]' }] },
  renderHTML({ HTMLAttributes, node }) {
    const type = normalizeCalloutType(node.attrs.type)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: `callout callout-${type}` }), 0]
  },

  addNodeView() { return ReactNodeViewRenderer(CalloutView) },

  addCommands() {
    const calloutType = this.type
    return {
      setCallout: (type = 'note') => ({ commands }) => commands.wrapIn(this.name, { type: normalizeCalloutType(type) }),
      toggleCallout: (type = 'note') => ({ commands }) => commands.toggleWrap(this.name, { type: normalizeCalloutType(type) }),
      // Promote any `> [!TYPE]` blockquote in the doc into a callout. Used on
      // content load (appendTransaction misses the editor's *initial* content).
      promoteCallouts: () => ({ state, dispatch }) => {
        const tr = buildCalloutPromotion(state, calloutType)
        if (tr && dispatch) dispatch(tr)
        return !!tr
      },
    }
  },

  // tiptap-markdown picks this up: render the callout as a `> [!TYPE]` blockquote.
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.wrapBlock('> ', null, node, () => {
            state.write(calloutHeaderLine(node.attrs.type))
            state.ensureNewLine()
            state.renderContent(node)
          })
        },
        parse: {},
      },
    }
  },

  addProseMirrorPlugins() {
    const calloutType = this.type
    return [new Plugin({
      key: new PluginKey('calloutFromBlockquote'),
      // Promote `> [!TYPE]` blockquotes into callouts on paste / when a user types
      // the syntax. (Initial content is handled by the promoteCallouts command,
      // called onCreate — appendTransaction doesn't fire for it.)
      appendTransaction: (trs, _oldState, newState) => {
        if (!trs.some((tr) => tr.docChanged)) return null
        return buildCalloutPromotion(newState, calloutType)
      },
    })]
  },
})

// Build a transaction promoting every `> [!TYPE]` blockquote into a callout, or
// null if there are none. Defensive: any failure returns null (the blockquote
// stays — content is never lost).
function buildCalloutPromotion(state, calloutType) {
  const blockquote = state.schema.nodes.blockquote
  if (!blockquote || !calloutType) return null
  const jobs = []
  state.doc.descendants((node, pos) => {
    if (node.type !== blockquote) return undefined
    const first = node.firstChild
    if (first && first.isTextblock && parseCalloutHeader(first.textContent)) jobs.push({ pos, node })
    return false // never descend into a blockquote we're about to replace
  })
  if (!jobs.length) return null
  try {
    let tr = state.tr
    for (const job of jobs) {
      const node = job.node
      const from = tr.mapping.map(job.pos)
      const first = node.firstChild
      const type = parseCalloutHeader(first.textContent).type
      const strippedText = stripCalloutHeader(first.textContent)
      const newFirst = first.type.create(first.attrs, strippedText ? state.schema.text(strippedText) : null)
      const rest = []
      node.content.forEach((child, _o, index) => { if (index > 0) rest.push(child) })
      const callout = calloutType.create({ type }, [newFirst, ...rest])
      tr = tr.replaceWith(from, from + node.nodeSize, callout)
    }
    return tr.docChanged ? tr : null
  } catch { return null }
}
