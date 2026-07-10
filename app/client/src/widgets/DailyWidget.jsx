import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTaskList, selectStalled, selectTriagedThisWeek, dueBucket, byImportanceThenDue, isRealDate, parseQuickAdd, completionDays, widgetStore, TaskRow, SkeletonRows, ErrorState, ReconnectBanner, UndoBar, QuickAddPreview, useWidgetSize, atMostW, atMostH, IconSun, IconMoon, IconPlus, IconCheck, IconX } from '../widget-sdk'
import './DailyWidget.css'

const NOTE_KEY = 'daily-note' // { date, text }
const DAY_BUDGET_MIN = 360 // ~6 focused hours; the estimate roll-up flags overcommitment (planning fallacy)
const SUGGEST_CAP = 10
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const at9 = (offsetDays = 0) => { const d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d.toISOString() }
const fmtMin = (m) => { m = Math.round(m || 0); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h${r}` : `${h}h` }

// Daily Planning + Shutdown ritual (Sunsama/Akiflow model). Morning: pull a few
// overdue / due-today / stalled tasks into a small "today" set, schedule them, and
// watch an estimate roll-up so the day isn't overcommitted (planning fallacy).
// Evening: recap what got done and roll the rest to tomorrow. The app reviews
// weekly (Review widget) but never guided a single day — this fills that gap.
// The plan itself is server-stored (ctx.plan) so it syncs across browsers and is
// readable by integrations; the shutdown note stays device-local (widgetStore);
// the tasks themselves stay in CalDAV.
export default function DailyWidget({ tasks: tasksCap, projects, plan, instanceId }) {
  const sz = useWidgetSize()
  const compact = atMostW(sz, 'sm') || atMostH(sz, 'sm')
  const short = atMostH(sz, 'xs')
  const inboxId = projects?.[0]?.id
  const selector = useCallback((all) => all, [])
  const { tasks, state, load, onToggle, onDelete, onSchedule, onSetPriority, onSetCue, onPatch, undo, dismissUndo } = useTaskList(tasksCap, selector)
  const store = useMemo(() => widgetStore(instanceId), [instanceId])
  const todayKey = ymd(new Date())

  const [mode, setMode] = useState('plan') // 'plan' | 'shutdown'
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [planIds, setPlanIds] = useState([])
  useEffect(() => {
    let alive = true
    plan.get(todayKey).then((r) => { if (alive) setPlanIds(Array.isArray(r?.ids) ? r.ids : []) }).catch(() => { /* keep [] — plan is additive UX */ })
    return () => { alive = false }
  }, [plan, todayKey])
  const savePlan = (ids) => {
    // Optimistic: the plan is a tiny id list — apply locally, revert on failure.
    const prev = planIds
    setPlanIds(ids)
    // Notify other widgets (e.g. FocusWidget) that the plan changed, so they
    // can re-read without polling.
    window.dispatchEvent(new CustomEvent('reminders:plan-changed'))
    plan.set(todayKey, ids).catch(() => {
      setPlanIds(prev)
      setErr('Could not save today’s plan — check your connection.')
      window.dispatchEvent(new CustomEvent('reminders:plan-changed'))
    })
  }
  const [note, setNote] = useState(() => { const n = store.loadJson(NOTE_KEY, null); return n && n.date === todayKey ? n.text : '' })
  const saveNote = (text) => { setNote(text); store.saveJson(NOTE_KEY, { date: todayKey, text }) }

  const byId = useMemo(() => { const m = new Map(); for (const t of tasks) m.set(t.id, t); return m }, [tasks])
  const open = useMemo(() => tasks.filter((t) => !t.done && !t.is_goal), [tasks])
  const chosen = useMemo(() => planIds.map((id) => byId.get(id)).filter((t) => t && !t.done), [planIds, byId])
  const plannedMin = chosen.reduce((s, t) => s + (t.time_estimate || 0), 0)
  const over = plannedMin > DAY_BUDGET_MIN

  const suggestions = useMemo(() => {
    const chosenSet = new Set(planIds)
    const seen = new Set(), out = []
    const add = (t) => { if (t && !chosenSet.has(t.id) && !seen.has(t.id)) { seen.add(t.id); out.push(t) } }
    open.filter((t) => isRealDate(t.due_date) && ['overdue', 'today'].includes(dueBucket(t.due_date).k)).sort(byImportanceThenDue).forEach(add)
    selectStalled(tasks).slice().sort(byImportanceThenDue).forEach(add)
    // Also surface tasks that are already triaged (estimate + schedule) for the
    // near future — the user decided on these, so they're warm candidates for
    // pulling into today rather than discovering them only on the due date.
    selectTriagedThisWeek(tasks).slice().sort(byImportanceThenDue).forEach(add)
    return out.slice(0, SUGGEST_CAP)
  }, [open, tasks, planIds])

  const addToToday = (t) => { savePlan([...new Set([...planIds, t.id])]); if (!isRealDate(t.due_date)) onSchedule(t, { due_date: at9(0) }) }
  const removeFromToday = (id) => savePlan(planIds.filter((x) => x !== id))
  const carryTomorrow = (t) => { onSchedule(t, { due_date: at9(1) }); removeFromToday(t.id) }

  const addTask = async (e) => {
    e.preventDefault()
    const raw = draft.trim(); if (!raw || !inboxId) return
    setErr(''); setDraft('')
    const parsed = parseQuickAdd(raw)
    try {
      const created = await tasksCap.create(inboxId, {
        title: parsed.title || raw,
        priority: parsed.priority || 0,
        due_date: parsed.due_date || at9(0),
        ...(parsed.labels?.length ? { labels: parsed.labels } : {}),
        ...(parsed.cue ? { cue: parsed.cue } : {}),
        ...(parsed.cue_trigger ? { cue_trigger: parsed.cue_trigger } : {}),
      })
      if (created?.id) savePlan([...new Set([...planIds, created.id])])
      tasksCap.emitChanged(); load()
    } catch (e2) {
      setDraft(raw)
      let msg = 'Could not add task.'
      try { msg = JSON.parse(e2.message).error || msg } catch { /* keep default */ }
      setErr(msg)
    }
  }

  const doneToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    return completionDays(tasks, start, end).length
  }, [tasks])

  // Loading/error only ever gate the today/suggestions (or carry-over) data
  // region below — the mode toggle, add-form and quick-add hint are stable
  // chrome that stays mounted so the widget doesn't flash in and out on a
  // background refresh. A refresh failure with a plan already loaded keeps it
  // visible plus a ReconnectBanner; only a never-loaded failure blanks to ErrorState.
  const hasData = tasks.length > 0

  const toggle = (
    <div className="daily-toggle" role="tablist">
      <button className={`daily-seg${mode === 'plan' ? ' on' : ''}`} role="tab" aria-selected={mode === 'plan'} onClick={() => setMode('plan')}><IconSun size={14} /> Plan</button>
      <button className={`daily-seg${mode === 'shutdown' ? ' on' : ''}`} role="tab" aria-selected={mode === 'shutdown'} onClick={() => setMode('shutdown')}><IconMoon size={14} /> Shutdown</button>
    </div>
  )
  const taskRow = (t) => <TaskRow task={t} onToggle={onToggle} onDelete={onDelete} onSchedule={onSchedule} onSetPriority={onSetPriority} onSetCue={onSetCue} onPatch={onPatch} dense={compact} />
  const visibleSuggestions = compact ? suggestions.slice(0, short ? 0 : 3) : suggestions

  const loadingOrError = state === 'loading' ? <SkeletonRows n={4} />
    : state === 'error' && !hasData ? <ErrorState onRetry={load} />
    : null
  const reconnect = state === 'error' && hasData ? <ReconnectBanner onRetry={load} /> : null
  const showData = state === 'ready' || (state === 'error' && hasData)

  return (
    <div className={`tasklist daily${compact ? ' compact' : ''}${short ? ' short' : ''}`}>
      {toggle}

      {mode === 'plan' ? (
        <>
          {inboxId && (
            <form className="add-row qa rem-add" onSubmit={addTask}>
              <IconSun size={16} />
              <input className="rem-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Plan something for today…" aria-label="Add a task to today" />
              <button type="submit" className="iconbtn sm" aria-label="Add" title="Add to today"><IconPlus size={16} /></button>
            </form>
          )}
          {err && <div role="alert" className="rem-err">{err}</div>}
          {inboxId && !short && <QuickAddPreview text={draft} />}

          {loadingOrError}
          {reconnect}

          {showData && (
            <>
              <div className="group-head daily-secline">
                <span className="g-title">Today’s focus</span>
                <span className={`chip daily-budget${over ? ' over' : ''}`} title={over ? 'More planned than a typical focused day — consider trimming' : 'Estimated time vs a ~6h focused day'}>
                  {plannedMin > 0 ? `${fmtMin(plannedMin)} / ${fmtMin(DAY_BUDGET_MIN)}` : `0 / ${fmtMin(DAY_BUDGET_MIN)}`}
                </span>
              </div>
              {chosen.length === 0
                ? <div className="daily-empty">Pick 1–3 things to focus on today from the suggestions below.</div>
                : <div className="task-stream">{chosen.map((t) => (
                  <div key={t.id} className="daily-row">
                    <div className="daily-row-main">{taskRow(t)}</div>
                    <button className="iconbtn sm daily-x" title="Remove from today" aria-label="Remove from today" onClick={() => removeFromToday(t.id)}><IconX size={14} /></button>
                  </div>
                ))}</div>}

              {!short && <div className="group-head daily-secline"><span className="g-title">Suggestions</span><span className="g-count">{suggestions.length}</span></div>}
              {suggestions.length === 0
                ? <div className="daily-empty">Nothing overdue or unscheduled — you’re on top of it.</div>
                : short
                  ? <div className="daily-suggest-compact">{suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} ready when you expand.</div>
                  : <div className="daily-suggest">{visibleSuggestions.map((t) => {
                  const b = isRealDate(t.due_date) ? dueBucket(t.due_date) : null
                  return (
                    <button key={t.id} type="button" className="daily-sg" onClick={() => addToToday(t)} title="Add to today">
                      <IconPlus size={13} />
                      <span className="daily-sg-t">{t.title}</span>
                      {b && <span className={`chip ${b.k === 'overdue' ? 'overdue' : 'due-soon'}`}>{b.label}</span>}
                    </button>
                  )
                })}{compact && suggestions.length > visibleSuggestions.length && (
                  <div className="daily-suggest-compact">+{suggestions.length - visibleSuggestions.length} more suggestions hidden until there is more room.</div>
                )}</div>}
            </>
          )}
        </>
      ) : (
        <>
          {loadingOrError}
          {reconnect}

          {showData && (
            <>
              <div className="daily-recap"><IconCheck size={16} /> <b>{doneToday}</b> done today</div>

              <div className="group-head daily-secline"><span className="g-title">Carry over</span><span className="g-count">{chosen.length}</span></div>
              {chosen.length === 0
                ? <div className="daily-empty daily-empty-done"><IconMoon size={13} /> Today’s focus is all done — close the day.</div>
                : <div className="task-stream">{chosen.map((t) => (
                  <div key={t.id} className="daily-row">
                    <div className="daily-row-main">{taskRow(t)}</div>
                    <button className="btn ghost sm daily-carry" title="Move to tomorrow" onClick={() => carryTomorrow(t)}>→ Tomorrow</button>
                  </div>
                ))}</div>}
              {planIds.length > 0 && <button className="btn ghost sm daily-clear" onClick={() => savePlan([])}>Clear today’s plan</button>}

              {!short && (
                <>
                  <div className="group-head daily-secline"><span className="g-title">Note to tomorrow</span></div>
                  <textarea className="input daily-note" value={note} onChange={(e) => saveNote(e.target.value)} placeholder="Where did you leave off? What’s first tomorrow?" />
                </>
              )}
            </>
          )}
        </>
      )}
      {undo && <UndoBar undo={undo} dismiss={dismissUndo} />}
    </div>
  )
}
