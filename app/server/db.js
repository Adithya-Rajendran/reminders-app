import pg from 'pg'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_dashboards (
      user_id       text NOT NULL,
      dashboard_id  text NOT NULL,
      layout_json   jsonb NOT NULL,
      layout_version integer NOT NULL DEFAULT 1,
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, dashboard_id)
    )
  `)
  console.log('db ready')
}

export async function getLayout(userId, dashboardId) {
  const r = await pool.query(
    'SELECT layout_json, layout_version FROM user_dashboards WHERE user_id=$1 AND dashboard_id=$2',
    [userId, dashboardId],
  )
  if (!r.rows.length) return { layout: null }
  return { layout: r.rows[0].layout_json, version: r.rows[0].layout_version }
}

export async function saveLayout(userId, dashboardId, body) {
  const layout = body?.layout ?? body
  let version = Number(body?.layout?.version || body?.version || 1)
  if (!Number.isFinite(version)) version = 1
  version = Math.trunc(version)
  await pool.query(
    `INSERT INTO user_dashboards (user_id, dashboard_id, layout_json, layout_version, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, dashboard_id)
     DO UPDATE SET layout_json = EXCLUDED.layout_json,
                   layout_version = EXCLUDED.layout_version,
                   updated_at = now()`,
    // Serialize explicitly so an array layout is stored as jsonb rather than
    // being coerced into a Postgres array literal (which errors on a jsonb col).
    [userId, dashboardId, JSON.stringify(layout), version],
  )
}
