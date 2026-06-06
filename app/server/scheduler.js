// In-app reminder scheduler — replaces Vikunja's cron->webhook->SSE.
// A single-replica poller over task_reminders with an atomic `fired_at` claim
// (FOR UPDATE SKIP LOCKED), automatic boot catch-up (the steady-state predicate
// `remind_at <= now() AND fired_at IS NULL` already covers everything that came
// due while the pod was down), and at-most-once delivery (the task list — and
// its overdue chips — is the durable source of truth). Gated on the postgres
// backend so it stays dormant until cutover and on rollback.
import { pool } from './db.js'
import { sendToUser } from './events.js'

const ZERO = '0001-01-01T00:00:00Z'
const outTs = (d) => (d && new Date(d).getUTCFullYear() > 1) ? new Date(d).toISOString() : ZERO

// Byte-compatible with the old Vikunja webhook envelope so RemindersWidget /
// Dashboard need zero change (event name "vikunja"; ev.data.event.data.task).
function reminderEvent(name, row) {
  return {
    receivedAt: Date.now(),
    event: {
      event_name: name,
      data: {
        task: {
          id: Number(row.task_id),
          title: row.title,
          due_date: outTs(row.due_date),
          priority: row.priority,
          done: row.done,
          reminders: row.remind_at ? [{ reminder: new Date(row.remind_at).toISOString() }] : [],
        },
      },
    },
  }
}

let ticking = false
async function tick() {
  if (ticking) return // never overlap a slow tick with the next interval
  ticking = true
  try {
    // (1) Fired reminders — claim atomically so a reminder is delivered at most once.
    const due = await pool.query(`
      WITH claimed AS (
        SELECT id FROM task_reminders
         WHERE fired_at IS NULL AND remind_at <= now()
         ORDER BY remind_at FOR UPDATE SKIP LOCKED LIMIT 500)
      UPDATE task_reminders r SET fired_at = now()
        FROM claimed, tasks t WHERE r.id = claimed.id AND t.id = r.task_id
      RETURNING r.task_id, r.user_id, r.remind_at, t.title, t.due_date, t.done, t.priority`)
    for (const row of due.rows) {
      if (row.done) continue // task completed before the reminder fired
      sendToUser(row.user_id, 'vikunja', reminderEvent('task.reminder', row))
    }

    // (2) Overdue sweep — one alert per task per due_date (re-fires if rescheduled later).
    const over = await pool.query(`
      WITH claimed AS (
        SELECT id FROM tasks
         WHERE done = false AND due_date IS NOT NULL AND due_date <= now()
           AND (overdue_notified_at IS NULL OR overdue_notified_at < due_date)
         ORDER BY due_date FOR UPDATE SKIP LOCKED LIMIT 500)
      UPDATE tasks t SET overdue_notified_at = now()
        FROM claimed WHERE t.id = claimed.id
      RETURNING t.id AS task_id, t.user_id, t.title, t.due_date, t.priority, t.done`)
    for (const row of over.rows) {
      sendToUser(row.user_id, 'vikunja', reminderEvent('task.overdue', row))
    }
  } catch (e) {
    console.error('scheduler tick error:', e?.message || e)
  } finally {
    ticking = false
  }
}

let timer = null
export function startScheduler() {
  const ms = Math.max(5000, Number(process.env.REMINDER_POLL_MS) || 30000)
  tick() // immediate boot catch-up for anything due while we were down
  timer = setInterval(tick, ms)
  timer.unref?.()
  console.log('reminder scheduler started (interval ' + ms + 'ms)')
}

export function stopScheduler() { if (timer) { clearInterval(timer); timer = null } }

// exported for tests
export { tick as _tick, reminderEvent as _reminderEvent }
