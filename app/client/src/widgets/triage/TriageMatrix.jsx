import { QUADS } from './constants.js'
import TriageQuadrant from './TriageQuadrant.jsx'

export default function TriageMatrix({
  quads,
  layout,
  dragOver,
  setDragOver,
  onDropInto,
  onToggle,
  onSchedule,
  onSetPriority,
  onPatch,
}) {
  return (
    <div
      className={`eisen eisen-${layout.matrixMode}${layout.roomy ? ' roomy' : ''}`}
      data-layout={layout.matrixMode}
      data-cell-scale="proportional"
    >
      {QUADS.map((quad) => (
        <TriageQuadrant
          key={quad.k}
          quad={quad}
          tasks={quads[quad.k]}
          rowCap={layout.rowCap}
          showSubtitle={layout.showSubtitles}
          dragOver={dragOver === quad.k}
          onDragOver={(e) => { e.preventDefault(); setDragOver(quad.k) }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(null) }}
          onDrop={(e) => onDropInto(quad.k, e)}
          onToggle={onToggle}
          onSchedule={onSchedule}
          onSetPriority={onSetPriority}
          onPatch={onPatch}
        />
      ))}
    </div>
  )
}
