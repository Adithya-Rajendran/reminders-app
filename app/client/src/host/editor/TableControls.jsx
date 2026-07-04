// Compact table controls, shown just below the toolbar while the caret is in a
// table. Maps to Tiptap's built-in table commands. (Renders only when active;
// the editor re-renders on every transaction so isActive('table') is live.)
export default function TableControls({ editor }) {
  if (!editor || !editor.isActive('table')) return null
  const c = () => editor.chain().focus()
  const Btn = ({ on, label, title }) => (
    <button type="button" className="tc-btn" title={title} aria-label={title}
      onMouseDown={(e) => { e.preventDefault(); on() }}>{label}</button>
  )
  return (
    <div className="table-controls">
      <Btn on={() => c().addRowAfter().run()} label="+ Row" title="Add row below" />
      <Btn on={() => c().addColumnAfter().run()} label="+ Col" title="Add column right" />
      <Btn on={() => c().deleteRow().run()} label="− Row" title="Delete row" />
      <Btn on={() => c().deleteColumn().run()} label="− Col" title="Delete column" />
      <span className="tc-sep" />
      <Btn on={() => c().toggleHeaderRow().run()} label="Header" title="Toggle header row" />
      <Btn on={() => c().deleteTable().run()} label="Delete table" title="Delete table" />
    </div>
  )
}
