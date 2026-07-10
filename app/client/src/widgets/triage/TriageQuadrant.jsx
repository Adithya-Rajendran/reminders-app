import { TaskRow } from '../../widget-sdk'

export default function TriageQuadrant({
  quad,
  tasks,
  rowCap,
  showSubtitle,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onToggle,
  onSchedule,
  onSetPriority,
  onPatch,
}) {
  const visible = tasks.slice(0, rowCap)
  const extra = tasks.length - visible.length

  return (
    <div
      className={`eq eq-${quad.k}${dragOver ? ' drop-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="eq-head"><span className="eq-label">{quad.label}</span><span className="eq-count">{tasks.length}</span></div>
      {showSubtitle && <div className="eq-sub">{quad.sub}</div>}
      <div className="eq-list">
        {visible.map((task) => (
          <div
            key={task.id}
            className="eq-drag"
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(task.id)); e.dataTransfer.effectAllowed = 'move' }}
          >
            <TaskRow
              task={task}
              dense
              onToggle={onToggle}
              onSchedule={onSchedule}
              onSetPriority={onSetPriority}
              onPatch={onPatch}
            />
          </div>
        ))}
        {extra > 0 && <div className="eq-more">+{extra} more</div>}
        {tasks.length === 0 && <div className="inline-empty start faint eq-empty">Drop a task here</div>}
      </div>
    </div>
  )
}
