import { wordCount, readingTime } from './notewordcount.js'

const fmtDate = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Status bar under the editor: word count, reading time, and the note's
// created/updated dates (from the note's front-matter meta).
export default function NoteInfoBar({ meta, body }) {
  const words = wordCount(body)
  const created = fmtDate(meta?.created)
  const updated = fmtDate(meta?.updated)
  return (
    <div className="note-info-bar">
      <span>{words} {words === 1 ? 'word' : 'words'}</span>
      <span>{readingTime(words)} min read</span>
      {created && <span>Created {created}</span>}
      {updated && <span>Updated {updated}</span>}
    </div>
  )
}
