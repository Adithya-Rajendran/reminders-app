// Postgres-native task / project / label store — replaces the Vikunja proxy.
// Every handler is scoped to req.session.user.sub and returns the SAME wire
// shape Vikunja did, so the SPA is unchanged. Unlike Vikunja's POST (a full
// object replace), patchTask is a true partial update.
import { pool } from './db.js'
import { nextOccurrence } from './recurrence.js'

const ZERO = '0001-01-01T00:00:00Z'
const outTs = (d) => (d && new Date(d).getUTCFullYear() > 1) ? new Date(d).toISOString() : ZERO
// Accept null / '' / the zero sentinel / a real date on the wire -> Date|null.
const inTs = (v) => {
  if (v === null || v === undefined || v === '' || v === ZERO) return null
  const d = new Date(v)
  return (isNaN(d) || d.getUTCFullYear() <= 1) ? null : d
}
const clampPriority = (p) => { const n = Math.trunc(Number(p)); return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0 }
const normRepeatAfter = (v) => Math.max(0, Math.trunc(Number(v) || 0))
const normRepeatMode = (v) => ([0, 1, 2].includes(Number(v)) ? Number(v) : 0)

function serializeTask(row) {
  return {
    id: Number(row.id), project_id: Number(row.project_id),
    title: row.title, description: row.description || '',
    done: row.done, done_at: outTs(row.done_at), due_date: outTs(row.due_date),
    priority: row.priority, repeat_after: row.repeat_after, repeat_mode: row.repeat_mode,
    reminders: (row.reminders || []).map((r) => ({ reminder: new Date(r.reminder).toISOString() })),
    labels: (row.labels || []).map((l) => ({ id: Number(l.id), title: l.title, hex_color: l.hex_color })),
    created: outTs(row.created_at), updated: outTs(row.updated_at),
  }
}

// Read projection: one task with its labels + reminders aggregated as JSON.
const TASK_SELECT = `
  SELECT t.id, t.title, t.description, t.done, t.done_at, t.due_date, t.priority,
         t.repeat_after, t.repeat_mode, t.project_id, t.position, t.created_at, t.updated_at,
         COALESCE(l.labels,'[]'::json)    AS labels,
         COALESCE(r.reminders,'[]'::json) AS reminders
  FROM tasks t
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id',lb.id,'title',lb.title,'hex_color',lb.hex_color) ORDER BY lower(lb.title)) AS labels
    FROM task_labels tl JOIN labels lb ON lb.id=tl.label_id WHERE tl.task_id=t.id) l ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('reminder', tr.remind_at) ORDER BY tr.remind_at) AS reminders
    FROM task_reminders tr WHERE tr.task_id=t.id) r ON true`

const SORT_COLS = { due_date: 't.due_date', priority: 't.priority', created_at: 't.created_at', position: 't.position' }

// ---- helpers ----
async function ensureInbox(userId) {
  const r = await pool.query(
    `INSERT INTO projects (user_id, title, is_inbox, position) VALUES ($1,'Inbox',true,0)
     ON CONFLICT (user_id) WHERE is_inbox DO NOTHING RETURNING id`, [userId])
  if (r.rows.length) return Number(r.rows[0].id)
  const s = await pool.query('SELECT id FROM projects WHERE user_id=$1 AND is_inbox', [userId])
  return Number(s.rows[0].id)
}
async function ownProject(uid, id) {
  if (!id) return false
  return (await pool.query('SELECT 1 FROM projects WHERE id=$1 AND user_id=$2', [id, uid])).rowCount > 0
}
async function ownLabel(uid, id) {
  if (!id) return false
  return (await pool.query('SELECT 1 FROM labels WHERE id=$1 AND user_id=$2', [id, uid])).rowCount > 0
}
async function getTaskRow(uid, id) {
  const r = await pool.query('SELECT id, project_id, due_date, done, repeat_after, repeat_mode FROM tasks WHERE id=$1 AND user_id=$2', [id, uid])
  return r.rows[0] || null
}
async function getReminderDates(uid, id) {
  const r = await pool.query('SELECT remind_at FROM task_reminders WHERE task_id=$1 AND user_id=$2 ORDER BY remind_at', [id, uid])
  return r.rows.map((x) => new Date(x.remind_at))
}
async function oneTask(uid, id) {
  const r = await pool.query(TASK_SELECT + ' WHERE t.user_id=$1 AND t.id=$2', [uid, id])
  return r.rows.length ? serializeTask(r.rows[0]) : null
}
async function replaceReminders(client, uid, taskId, reminders) {
  await client.query('DELETE FROM task_reminders WHERE task_id=$1 AND user_id=$2', [taskId, uid])
  if (!Array.isArray(reminders)) return
  for (const r of reminders) {
    const when = inTs(r && typeof r === 'object' ? r.reminder : r)
    if (!when) continue
    await client.query(
      'INSERT INTO task_reminders (task_id, user_id, remind_at) VALUES ($1,$2,$3) ON CONFLICT (task_id, remind_at) DO NOTHING',
      [taskId, uid, when])
  }
}

// ---- handlers (mounted at /api/projects, /api/tasks, /api/labels) ----
export async function listProjects(req, res, next) {
  try {
    const uid = req.session.user.sub
    await ensureInbox(uid)
    const r = await pool.query('SELECT id, title, hex_color, is_inbox FROM projects WHERE user_id=$1 ORDER BY is_inbox DESC, position, id', [uid])
    res.json(r.rows.map((p) => ({ id: Number(p.id), title: p.title, hex_color: p.hex_color, is_inbox: p.is_inbox, description: '', parent_project_id: 0 })))
  } catch (e) { next(e) }
}

export async function listProjectTasks(req, res, next) {
  try {
    const uid = req.session.user.sub
    const pid = Number(req.params.id)
    if (!(await ownProject(uid, pid))) return res.status(404).json({ error: 'not found' })
    const per = Math.min(Number(req.query.per_page) || 250, 250)
    const r = await pool.query(TASK_SELECT + ' WHERE t.user_id=$1 AND t.project_id=$2 ORDER BY t.done, t.position, t.id LIMIT $3', [uid, pid, per])
    res.json(r.rows.map(serializeTask))
  } catch (e) { next(e) }
}

export async function listTasks(req, res, next) {
  try {
    const uid = req.session.user.sub
    const col = SORT_COLS[req.query.sort_by] || 't.due_date'
    const dir = req.query.order_by === 'desc' ? 'DESC' : 'ASC'
    const per = Math.min(Number(req.query.per_page) || 250, 250)
    const r = await pool.query(TASK_SELECT + ` WHERE t.user_id=$1 ORDER BY ${col} ${dir} NULLS LAST, t.id LIMIT $2`, [uid, per])
    res.json(r.rows.map(serializeTask))
  } catch (e) { next(e) }
}

export async function createTask(req, res, next) {
  const uid = req.session.user.sub
  const pid = Number(req.params.id)
  const b = req.body || {}
  const title = (b.title || '').trim()
  if (!title) return res.status(400).json({ error: 'title is required' })
  if (!(await ownProject(uid, pid))) return res.status(404).json({ error: 'not found' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pos = await client.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM tasks WHERE user_id=$1 AND project_id=$2', [uid, pid])
    const ins = await client.query(
      `INSERT INTO tasks (user_id, project_id, title, description, priority, due_date, repeat_after, repeat_mode, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [uid, pid, title, b.description || '', clampPriority(b.priority), inTs(b.due_date), normRepeatAfter(b.repeat_after), normRepeatMode(b.repeat_mode), pos.rows[0].p])
    const id = Number(ins.rows[0].id)
    await replaceReminders(client, uid, id, b.reminders)
    await client.query('COMMIT')
    res.status(201).json(await oneTask(uid, id))
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e) }
  finally { client.release() }
}

export async function patchTask(req, res, next) {
  const uid = req.session.user.sub
  const id = Number(req.params.id)
  const b = req.body || {}
  const cur = await getTaskRow(uid, id)
  if (!cur) return res.status(404).json({ error: 'not found' })
  if ('title' in b && !(b.title || '').trim()) return res.status(400).json({ error: 'title cannot be empty' })
  if ('project_id' in b && !(await ownProject(uid, Number(b.project_id)))) return res.status(404).json({ error: 'project not found' })

  // dedupe columns via a Map (recurrence's due_date must override a body due_date)
  const fields = new Map()
  if ('title' in b) fields.set('title', b.title.trim())
  if ('description' in b) fields.set('description', b.description || '')
  if ('priority' in b) fields.set('priority', clampPriority(b.priority))
  if ('due_date' in b) fields.set('due_date', inTs(b.due_date))
  if ('project_id' in b) fields.set('project_id', Number(b.project_id))
  if ('repeat_after' in b) fields.set('repeat_after', normRepeatAfter(b.repeat_after))
  if ('repeat_mode' in b) fields.set('repeat_mode', normRepeatMode(b.repeat_mode))

  const effRepeatAfter = 'repeat_after' in b ? normRepeatAfter(b.repeat_after) : cur.repeat_after
  const effRepeatMode = 'repeat_mode' in b ? normRepeatMode(b.repeat_mode) : cur.repeat_mode
  const recurringTask = effRepeatAfter > 0 || effRepeatMode === 1

  let advancedReminders = null
  if ('done' in b) {
    if (b.done && !cur.done && recurringTask) {
      // Recurring completion: don't complete — advance the occurrence.
      const nx = nextOccurrence({
        due_date: cur.due_date ? new Date(cur.due_date) : null,
        repeat_after: effRepeatAfter, repeat_mode: effRepeatMode,
        reminders: await getReminderDates(uid, id),
      })
      fields.set('done', false); fields.set('done_at', null)
      if (nx.advanced) { fields.set('due_date', nx.due_date); advancedReminders = nx.reminders }
    } else {
      fields.set('done', !!b.done); fields.set('done_at', b.done ? new Date() : null)
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (fields.size) {
      const cols = [...fields.keys()]
      const setSql = cols.map((c, idx) => `${c}=$${idx + 1}`).join(', ')
      const vals = cols.map((c) => fields.get(c))
      vals.push(uid, id)
      await client.query(`UPDATE tasks SET ${setSql} WHERE user_id=$${cols.length + 1} AND id=$${cols.length + 2}`, vals)
    }
    if ('reminders' in b) await replaceReminders(client, uid, id, b.reminders)
    else if (advancedReminders) await replaceReminders(client, uid, id, advancedReminders.map((d) => ({ reminder: d })))
    await client.query('COMMIT')
    res.json(await oneTask(uid, id))
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e) }
  finally { client.release() }
}

export async function deleteTask(req, res, next) {
  try {
    const r = await pool.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2', [Number(req.params.id), req.session.user.sub])
    if (!r.rowCount) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true, message: 'Successfully deleted.' })
  } catch (e) { next(e) }
}

export async function listLabels(req, res, next) {
  try {
    const r = await pool.query('SELECT id, title, hex_color FROM labels WHERE user_id=$1 ORDER BY lower(title)', [req.session.user.sub])
    res.json(r.rows.map((l) => ({ id: Number(l.id), title: l.title, hex_color: l.hex_color })))
  } catch (e) { next(e) }
}

export async function createLabel(req, res, next) {
  try {
    const title = (req.body?.title || '').trim()
    if (!title) return res.status(400).json({ error: 'title is required' })
    const r = await pool.query(
      `INSERT INTO labels (user_id, title) VALUES ($1,$2)
       ON CONFLICT (user_id, lower(title)) DO UPDATE SET title = labels.title
       RETURNING id, title, hex_color`, [req.session.user.sub, title])
    res.json({ id: Number(r.rows[0].id), title: r.rows[0].title, hex_color: r.rows[0].hex_color })
  } catch (e) { next(e) }
}

export async function attachLabel(req, res, next) {
  try {
    const uid = req.session.user.sub
    const taskId = Number(req.params.id)
    const labelId = Number(req.body?.label_id)
    if (!labelId) return res.status(400).json({ error: 'label_id is required' })
    if (!(await getTaskRow(uid, taskId))) return res.status(404).json({ error: 'task not found' })
    if (!(await ownLabel(uid, labelId))) return res.status(404).json({ error: 'label not found' })
    await pool.query('INSERT INTO task_labels (task_id, label_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [taskId, labelId, uid])
    res.json({ ok: true, label_id: labelId })
  } catch (e) { next(e) }
}
