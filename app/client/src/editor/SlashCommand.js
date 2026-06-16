import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { filterSlashItems } from './slashItems.js'

// Bridge between the ProseMirror suggestion plugin and the React popup: the popup
// subscribes for state, and the plugin routes key events to it. A module-level
// singleton is fine — only one editor's slash menu is ever active at a time.
let stateListener = null
let keyHandler = null
export const slashBridge = {
  subscribe(fn) { stateListener = fn; return () => { if (stateListener === fn) stateListener = null } },
  push(state) { stateListener?.(state) },
  setKeyHandler(fn) { keyHandler = fn },
  keydown(event) { return keyHandler ? keyHandler(event) : false },
}

// Apply a chosen slash item: remove the "/query" text, then insert the block.
function runSlashItem(editor, range, id) {
  const c = editor.chain().focus().deleteRange(range)
  switch (id) {
    case 'h1': return c.setNode('heading', { level: 1 }).run()
    case 'h2': return c.setNode('heading', { level: 2 }).run()
    case 'h3': return c.setNode('heading', { level: 3 }).run()
    case 'bullet': return c.toggleBulletList().run()
    case 'ordered': return c.toggleOrderedList().run()
    case 'task': return c.toggleTaskList().run()
    case 'quote': return c.toggleBlockquote().run()
    case 'callout': return c.setCallout('note').run()
    case 'code': return c.toggleCodeBlock().run()
    case 'table': return c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    case 'divider': return c.setHorizontalRule().run()
    default: return c.run()
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor,
      pluginKey: new PluginKey('slashSuggestion'), // distinct from the wikilink suggestion
      char: '/',
      allowSpaces: false,
      startOfLine: false,
      items: ({ query }) => filterSlashItems(query),
      command: ({ editor, range, props }) => runSlashItem(editor, range, props.id),
      allow: ({ editor }) => editor.isEditable && !editor.isActive('codeBlock'),
      render: () => ({
        onStart: (props) => slashBridge.push({ open: true, items: props.items, command: props.command, clientRect: props.clientRect, query: props.query }),
        onUpdate: (props) => slashBridge.push({ open: true, items: props.items, command: props.command, clientRect: props.clientRect, query: props.query }),
        onKeyDown: (props) => slashBridge.keydown(props.event),
        onExit: () => slashBridge.push({ open: false }),
      }),
    })]
  },
})
