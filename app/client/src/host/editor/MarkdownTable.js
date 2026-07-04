import { Table } from '@tiptap/extension-table'

// tiptap-markdown's built-in table serializer writes each cell via renderInline
// and escapes [ ] * _ ` ~ but NOT the pipe or newlines — so a `|` (or an aliased
// [[wikilink|alias]]) inside a cell silently breaks the GFM table on the next
// load. This override mirrors that serializer but escapes `|` → `\|` and folds
// newlines to spaces in cell content (GFM cells are single-line), keeping the
// table structure intact. (Only `serialize` is overridden; the default markdown-it
// table parse is preserved via the getMarkdownSpec merge.)
export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      ...(this.parent?.() || {}),
      markdown: {
        serialize(state, node) {
          state.inTable = true
          node.forEach((row, _p, i) => {
            state.write('| ')
            row.forEach((col, _cp, j) => {
              if (j) state.write(' | ')
              const cell = col.firstChild
              if (cell && cell.textContent.trim()) {
                const start = state.out.length
                state.renderInline(cell)
                const safe = state.out.slice(start).replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|')
                state.out = state.out.slice(0, start) + safe
              }
            })
            state.write(' |')
            state.ensureNewLine()
            if (!i) {
              const delim = Array.from({ length: row.childCount }).map(() => '---').join(' | ')
              state.write(`| ${delim} |`)
              state.ensureNewLine()
            }
          })
          state.closeBlock(node)
          state.inTable = false
        },
      },
    }
  },
})
