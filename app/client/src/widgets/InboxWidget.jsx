import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useTaskList, selectInbox,
  AreaPicker, ContextPicker, ImportanceControl, DateTimePicker,
  EmptyState, ErrorState, SkeletonRows, UndoBar, announce,
  dueChip, timeLabel, isRealDate,
  IconInbox, IconTrash, IconMoon, IconClock, IconCheck,
} from '../widget-sdk'
import './InboxWidget.css'

// The CLARIFY surface. Capture drops raw thoughts into the Inbox as
// clarified=false tasks; this widget is the deliberate second pass that turns
// each one into something actionable — deciding its Project/Area, Context(s),
// whether it's important, and when it's due — before it leaves the Inbox.
//
// Why ONE item at a time (a focused card, not a full editable list): clarifying
// is a decision task, and a wall of half-decided rows invites skimming and
// re-deferral. Surfacing a single item with all four controls in reach makes the
// decision the point, and the running count keeps "Inbox zero" visibly close.
//
// The label 'someday/maybe' is a GTD marker: a task you've decided NOT to act on
// now but don't want to lose. It leaves the Inbox (clarified=true) with no date,
// so it stops nagging but stays findable by its label.
const SOMEDAY_LABEL = 'someday/maybe'

// task.labels is [{title}]; Context + Someday both live there. These helpers keep
// the label array as the single source of truth so a Context edit never drops the
// someday marker and vice-versa.
const labelTitles = (task) => (task.labels || []).map((l) => l.title || l)
const asLabels = (titles) => titles.map((t) => ({ title: t }))
// Contexts shown in the picker exclude the someday marker — it's a lifecycle flag,
// not a "mode I'm in" context, so it shouldn't clutter the @-context set.
const contextsOf = (task) => labelTitles(task).filter((t) => t !== SOMEDAY_LABEL)

export default function InboxWidget({ tasks: tasksCap, organizer }) {
  const { tasks, state, load, onPatch, onSchedule, onDelete, undo, dismissUndo } = useTaskList(tasksCap, selectInbox)

  // Organizer options for the pickers. areas() is async (CalDAV-backed); contexts()
  // is a live derived list of label titles. Both are read once on mount and kept
  // in state — a widget-sized surface doesn't need to re-poll them mid-clarify.
  const [areas, setAreas] = useState([])
  const [contexts, setContexts] = useState([])
  useEffect(() => {
    let alive = true
    organizer?.areas?.().then((a) => { if (alive) setAreas(a || []) }).catch(() => {})
    try { setContexts(organizer?.contexts?.() || []) } catch { /* best-effort */ }
    return () => { alive = false }
  }, [organizer])

  // The focused item is the head of the Inbox queue. We DON'T track a separate
  // "current index": clarifying an item removes it from selectInbox (clarified flips
  // true / it gains a date), so the list naturally advances to the next unclarified
  // task with no cursor to keep in sync. A tight preview of what's behind it gives
  // the "how much is left" context the raw count can't.
  const focused = tasks[0] || null
  const upNext = tasks.slice(1, 5)

  // Date picker is a portal popover anchored to the "Add date" chip.
  const dateAnchor = useRef(null)
  const [dateOpen, setDateOpen] = useState(false)
  // Close the picker if the focused task changes out from under it (e.g. after a
  // Clarify), so it never re-opens against a stale anchor for the next item.
  useEffect(() => { setDateOpen(false) }, [focused?.id])

  const patchContexts = useCallback((task, nextContexts) => {
    // Preserve the someday marker (if present) while replacing the context set.
    const keepSomeday = labelTitles(task).includes(SOMEDAY_LABEL) ? [SOMEDAY_LABEL] : []
    onPatch(task, { labels: asLabels([...nextContexts, ...keepSomeday]) })
  }, [onPatch])

  const clarify = useCallback((task) => {
    onPatch(task, { clarified: true })
    announce(`Clarified: ${task.title}`)
  }, [onPatch])

  const someday = useCallback((task) => {
    // Someday = clarified, no date, marked with the someday label so it's findable.
    const next = contextsOf(task)
    onPatch(task, { clarified: true, labels: asLabels([...next, SOMEDAY_LABEL]) })
    announce(`Someday: ${task.title}`)
  }, [onPatch])

  if (state === 'loading') return <div className="inbox"><SkeletonRows n={3} /></div>
  if (state === 'error') return <div className="inbox"><ErrorState onRetry={load} /></div>

  if (!focused) {
    return (
      <div className="inbox">
        <EmptyState icon={IconInbox} title="Inbox zero — nothing to clarify." sub="New captures land here for a quick decide." />
        {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
      </div>
    )
  }

  const chip = dueChip(focused.due_date)
  const dated = isRealDate(focused.due_date)
  const focusContexts = contextsOf(focused)

  return (
    <div className="inbox">
      {/* Count of what's left to clarify — the whole point of the surface is to
          drive this to zero, so it leads. */}
      <div className="ib-head">
        <span className="ib-title"><IconInbox size={15} /> Inbox</span>
        <span className="ib-count" aria-label={`${tasks.length} to clarify`}>{tasks.length} to clarify</span>
      </div>

      {/* The focused item + its four clarify controls, all in reach. */}
      <div className="ib-card">
        <div className="ib-card-title">{focused.title}</div>

        <div className="ib-controls">
          <AreaPicker
            value={focused.area || ''}
            areas={areas}
            onSet={(id) => onPatch(focused, { area: id })}
          />
          <ContextPicker
            value={focusContexts}
            options={contexts}
            onSet={(next) => patchContexts(focused, next)}
            // Enable type-to-create: on a fresh account the derived context list is
            // empty, so without this you could never assign a context during Clarify.
            // The actual create+assign happens through onSet (which writes the label);
            // onCreate just flips the create affordance on.
            onCreate={() => {}}
          />
          <ImportanceControl
            value={!!focused.important}
            onSet={(v) => onPatch(focused, { important: v })}
          />
          {/* Date chip doubles as the picker anchor: shows the current due date
              (or "Add date"), opens the DateTimePicker on click. */}
          <button
            type="button" ref={dateAnchor}
            className={`chip ib-date${dated ? ' on' : ' empty'}`}
            aria-haspopup="dialog" aria-expanded={dateOpen}
            onClick={() => setDateOpen((o) => !o)}
          >
            <IconClock size={13} />
            {chip ? `${chip.label}${timeLabel(focused.due_date) ? ' · ' + timeLabel(focused.due_date) : ''}` : 'Add date'}
          </button>
          {dateOpen && (
            <DateTimePicker
              anchorRef={dateAnchor}
              value={focused.due_date}
              hasReminder={Array.isArray(focused.reminders) && focused.reminders.length > 0}
              onApply={({ due_date, reminder }) => { onSchedule(focused, { due_date, reminder }); setDateOpen(false) }}
              onClose={() => setDateOpen(false)}
            />
          )}
        </div>

        <div className="ib-actions">
          {/* Primary: move it out of the Inbox. */}
          <button type="button" className="btn primary sm ib-clarify" onClick={() => clarify(focused)}>
            <IconCheck size={14} /> Clarify
          </button>
          {/* Someday: decide NOT to act now without losing it. */}
          <button type="button" className="btn ghost sm" onClick={() => someday(focused)} title="Defer to Someday/Maybe — leaves the Inbox, no date">
            <IconMoon size={13} /> Someday
          </button>
          {/* Delete: it was noise. Undoable via the bar. */}
          <button type="button" className="iconbtn sm ib-del" aria-label={`Delete: ${focused.title}`} title="Delete" onClick={() => onDelete(focused)}>
            <IconTrash size={14} />
          </button>
        </div>
      </div>

      {/* A tight peek at what's next — enough to gauge the pile without inviting
          out-of-order editing (only the focused item is actionable). */}
      {upNext.length > 0 && (
        <div className="ib-upnext">
          <div className="ib-upnext-head">Up next</div>
          <ul className="ib-upnext-list">
            {upNext.map((t) => (
              <li key={t.id} className="ib-upnext-item">{t.title}</li>
            ))}
          </ul>
          {tasks.length > 5 && <div className="ib-upnext-more">+{tasks.length - 5} more</div>}
        </div>
      )}

      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
