import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import Suggestion from '@tiptap/suggestion'
import { WIKILINK_RE, parseWikilink, resolveWikilink } from '../wikilinks.js'
import { fuzzyRank } from '../fuzzy.js'

// Wikilinks stay as plain `[[Target]]` text in the doc (and on disk) — we never
// transform them into a node, so the markdown round-trip is exact. This plugin
// only *decorates* them (clickable, resolved/unresolved styling) and provides a
// `[[` autocomplete. Clicking a wikilink opens (or creates) the target note.

// Bridge to the React autocomplete popup (only one editor active at a time).
let stateListener = null, keyHandler = null
export const wikilinkBridge = {
  subscribe(fn) { stateListener = fn; return () => { if (stateListener === fn) stateListener = null } },
  push(s) { stateListener?.(s) },
  setKeyHandler(fn) { keyHandler = fn },
  keydown(e) { return keyHandler ? keyHandler(e) : false },
}

const decoKey = new PluginKey('wikilinkDeco')

function scanRanges(doc) {
  const ranges = []
  doc.descendants((node, pos, parent) => {
    if (!node.isText) return
    if (parent && parent.type.name === 'codeBlock') return       // skip code blocks
    if (node.marks.some((m) => m.type.name === 'code')) return    // skip inline code
    const text = node.text || ''
    WIKILINK_RE.lastIndex = 0
    let m
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const { target, alias } = parseWikilink(m[1])
      if (target) ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length, target, alias })
    }
  })
  return ranges
}

function buildState(doc, getNotes) {
  const ranges = scanRanges(doc)
  const notes = getNotes() || []
  const decos = ranges.map((r) => Decoration.inline(r.from, r.to, {
    class: `wikilink${resolveWikilink(r.target, notes) ? '' : ' unresolved'}`,
  }))
  return { ranges, set: DecorationSet.create(doc, decos) }
}

export const Wikilink = Extension.create({
  name: 'wikilink',
  addOptions() { return { getNotes: () => [], getFolder: () => '', onOpen: () => {} } },

  addProseMirrorPlugins() {
    const options = this.options
    const deco = new Plugin({
      key: decoKey,
      state: {
        init: (_, state) => buildState(state.doc, options.getNotes),
        apply: (tr, prev) => (tr.docChanged ? buildState(tr.doc, options.getNotes) : prev),
      },
      props: {
        decorations(state) { return decoKey.getState(state)?.set },
        handleClick: (view, pos) => {
          const st = decoKey.getState(view.state)
          const hit = st?.ranges.find((r) => pos >= r.from && pos < r.to)
          if (!hit) return false
          options.onOpen(hit.target, hit.alias, options.getFolder())
          return true
        },
      },
    })

    const suggestion = Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('wikilinkSuggestion'), // distinct from the slash suggestion
      char: '[[',
      allowSpaces: true,
      startOfLine: false,
      allow: ({ editor }) => editor.isEditable && !editor.isActive('codeBlock'),
      items: ({ query }) => {
        const notes = options.getNotes() || []
        const out = fuzzyRank(query, notes, (n) => n.title).slice(0, 8).map((r) => ({ title: r.item.title }))
        const q = (query || '').trim()
        if (q && !notes.some((n) => String(n.title || '').toLowerCase() === q.toLowerCase())) out.push({ title: q, create: true })
        return out
      },
      command: ({ editor, range, props }) => {
        const text = `[[${props.title}]]`
        editor.chain().focus().command(({ tr }) => { tr.insertText(text, range.from, range.to); return true }).run()
      },
      render: () => ({
        onStart: (p) => wikilinkBridge.push({ open: true, items: p.items, command: p.command, clientRect: p.clientRect, query: p.query }),
        onUpdate: (p) => wikilinkBridge.push({ open: true, items: p.items, command: p.command, clientRect: p.clientRect, query: p.query }),
        onKeyDown: (p) => wikilinkBridge.keydown(p.event),
        onExit: () => wikilinkBridge.push({ open: false }),
      }),
    })

    return [deco, suggestion]
  },
})
