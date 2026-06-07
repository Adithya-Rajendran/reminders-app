// In-app reminder poller for the CalDAV task store (replaces scheduler.js when
// TASK_STORE=caldav). Polls each connected user's VTODOs and fires per-user SSE
// 'reminder' events for VALARMs that have come due and for tasks that have gone
// overdue — using the SAME SSE envelope the Postgres scheduler used, so the
// client (RemindersWidget / Dashboard) is unchanged.
//
// State is fully IN-MEMORY and reset on restart — nothing about reminders is
// stored in our database. The authoritative reminder is the VALARM itself, which
// CalDAV syncs to the user's devices (DAVx5 / Tasks.org / Apple) as a real
// notification; the in-app toast is only a best-effort live nicety while the web
// app is open. On boot the first poll SEEDS everything already due WITHOUT
// firing, so a deploy never replays a burst of stale toasts.
import { sendToUser } from './events.js'
import { usersWithCaldav } from './config.js'
import { allUserVtodos, serializeVtodo } from './tasks_caldav.js'

const ZERO = '0001-01-01T00:00:00Z'
const isReal = (iso) => !!iso && iso !== ZERO && new Date(iso).getUTCFullYear() > 1

// Envelope consumed by RemindersWidget (ev.data.event.data.task) / Dashboard.
function reminderEvent(name, task, whenISO) {
  return {
    receivedAt: Date.now(),
    event: { event_name: name, data: { task: whenISO ? { ...task, reminders: [{ reminder: whenISO }] } : task } },
  }
}

export function freshState() {
  return { fired: new Set(), overdue: new Set(), seeded: false, live: new Set() }
}

// PURE decision core (no I/O) so the seed/fire/prune machine is deterministically
// testable with an injected `now`. Mutates the dedup sets and the `live`
// accumulator on `state`; returns the events to send this tick.
//   fired   : `${sub}|${task.id}|${iso}`    reminders already toasted this process
//   overdue : `${sub}|${task.id}|${dueISO}` overdue alerts already toasted (re-fires on reschedule)
export function evaluateUserTasks(sub, tasks, now, state) {
  const fires = []
  for (const task of tasks) {
    if (task.done) continue // a completed task never fires

    // (1) Fired reminders — one toast per VALARM trigger as it crosses "now".
    for (const { reminder } of task.reminders || []) {
      if (!isReal(reminder) || new Date(reminder).getTime() > now) continue
      const key = sub + '|' + task.id + '|' + reminder
      state.live.add(key)
      if (!state.seeded) { state.fired.add(key); continue } // boot seed: remember, don't replay
      if (state.fired.has(key)) continue
      state.fired.add(key)
      fires.push({ sub, payload: reminderEvent('task.reminder', task, reminder) })
    }

    // (2) Overdue sweep — one alert per task per due_date (re-fires if rescheduled later).
    if (isReal(task.due_date) && new Date(task.due_date).getTime() <= now) {
      const key = sub + '|' + task.id + '|' + task.due_date
      state.live.add('OD:' + key)
      if (!state.seeded) state.overdue.add(key)
      else if (!state.overdue.has(key)) { state.overdue.add(key); fires.push({ sub, payload: reminderEvent('task.overdue', task, null) }) }
    }
  }
  return fires
}

// Drop dedup entries whose backing alarm/overdue no longer exists (task edited,
// completed or deleted) so the in-memory sets stay bounded by live data.
export function pruneState(state) {
  for (const k of state.fired) if (!state.live.has(k)) state.fired.delete(k)
  for (const k of state.overdue) if (!state.live.has('OD:' + k)) state.overdue.delete(k)
  state.seeded = true
}

const state = freshState()

let ticking = false
async function tick() {
  if (ticking) return // never overlap a slow poll with the next interval
  ticking = true
  const now = Date.now()
  state.live = new Set()
  try {
    for (const sub of await usersWithCaldav()) {
      let items
      try { items = await allUserVtodos(sub) } catch { continue } // skip a user whose server is down
      const tasks = items.map(({ vt, listId, objectUrl }) => serializeVtodo(vt, listId, objectUrl))
      for (const f of evaluateUserTasks(sub, tasks, now, state)) sendToUser(f.sub, 'reminder', f.payload)
    }
    pruneState(state)
  } catch (e) {
    console.error('valarm poller tick error:', e?.message || e)
  } finally {
    ticking = false
  }
}

let timer = null
export function startValarmPoller() {
  const ms = Math.max(15000, Number(process.env.REMINDER_POLL_MS) || 60000)
  tick() // first poll seeds current state without firing
  timer = setInterval(tick, ms)
  timer.unref?.()
  console.log('caldav valarm poller started (interval ' + ms + 'ms)')
}
export function stopValarmPoller() { if (timer) { clearInterval(timer); timer = null } }

// exported for tests
export { tick as _tick }
