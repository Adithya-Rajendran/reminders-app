import { IconCheck, IconTarget } from '../../widget-sdk'

export default function MostImportantCard({ task, showWhy, why, onToggle }) {
  return (
    <div className="tri-focus">
      <div className="tri-focus-eyebrow"><IconTarget size={14} /> Most important</div>
      <button className="tri-focus-check" aria-label={`Complete: ${task.title}`} onClick={() => onToggle(task)}>
        <IconCheck size={16} />
      </button>
      <div className="tri-focus-body">
        <div className="tri-focus-title">{task.title}</div>
        {showWhy && <div className="tri-focus-why"><b>Why:</b> {why} — do this before easier, busier work.</div>}
      </div>
    </div>
  )
}
