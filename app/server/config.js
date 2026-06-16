// Config repository — the ONLY things this app persists in a database: dashboard
// layouts, CalDAV account credentials, CalDAV list selections, and login sessions.
// Everything else — tasks, projects, labels, reminders — lives in the user's
// CalDAV server, never here.
//
// SQLite (better-sqlite3, WAL) on a block-storage volume. The handle is opened
// SYNCHRONOUSLY at import so the session store can be constructed at app setup,
// before start() runs.
import session from 'express-session'
import sqliteStoreFactory from 'better-sqlite3-session-store'
import Database from 'better-sqlite3'

const path = process.env.CONFIG_DB_PATH
if (!path) { console.error('FATAL: CONFIG_DB_PATH is required'); process.exit(1) }

export const sqlite = new Database(path)
sqlite.pragma('journal_mode = WAL')      // safe on BLOCK storage (not NFS/CephFS)
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('synchronous = NORMAL')
sqlite.pragma('foreign_keys = ON')
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_dashboards (
    user_id TEXT NOT NULL, dashboard_id TEXT NOT NULL,
    layout_json TEXT NOT NULL, layout_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, dashboard_id));
  CREATE TABLE IF NOT EXISTS caldav_accounts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
    server_url TEXT NOT NULL, username TEXT NOT NULL, password_enc TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS caldav_accounts_user_idx ON caldav_accounts(user_id);
  CREATE TABLE IF NOT EXISTS caldav_lists (
    id INTEGER PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES caldav_accounts(id) ON DELETE CASCADE,
    url TEXT NOT NULL, display_name TEXT, color TEXT,
    supports_vtodo INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE (account_id, url));
  CREATE TABLE IF NOT EXISTS notes_config (
    user_id TEXT PRIMARY KEY, account_id TEXT, root_path TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS group_calendars (
    user_id TEXT NOT NULL, group_name TEXT NOT NULL, list_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_name));
  -- Full-text search index over note bodies. This is derived/cheap-to-recreate
  -- data: it is rebuilt lazily from the WebDAV walk and cleared per-user when
  -- they point notes at a different WebDAV (see notes.setConfig -> noteindex).
  CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
    body, title, folder UNINDEXED, path UNINDEXED, user_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2');
  -- [[wikilink]] edges (src note -> normalized target title), populated in the
  -- same pass; powers the backlinks panel.
  CREATE TABLE IF NOT EXISTS note_links (
    user_id TEXT NOT NULL, src_path TEXT NOT NULL,
    target TEXT NOT NULL, raw TEXT, context TEXT,
    PRIMARY KEY (user_id, src_path, target));
  CREATE INDEX IF NOT EXISTS note_links_target_idx ON note_links(user_id, target);
`)
console.log('sqlite config db ready at', path, '(journal_mode=' + sqlite.pragma('journal_mode', { simple: true }) + ')')

const bool = (v) => !!v && v !== 0 && v !== '0'

// Schema is built synchronously at import; kept for the start() call site.
export async function initConfigSchema() { /* no-op */ }

// ============================================================
//  Dashboard layouts
// ============================================================
export async function getLayout(userId, dashboardId) {
  const r = sqlite.prepare('SELECT layout_json, layout_version FROM user_dashboards WHERE user_id=? AND dashboard_id=?').get(userId, dashboardId)
  if (!r) return { layout: null }
  return { layout: JSON.parse(r.layout_json), version: r.layout_version }
}

export async function saveLayout(userId, dashboardId, body) {
  const layout = body?.layout ?? body
  let version = Number(body?.layout?.version || body?.version || 1)
  if (!Number.isFinite(version)) version = 1
  version = Math.trunc(version)
  sqlite.prepare(`INSERT INTO user_dashboards (user_id, dashboard_id, layout_json, layout_version, updated_at)
    VALUES (?,?,?,?,datetime('now'))
    ON CONFLICT(user_id, dashboard_id) DO UPDATE SET
      layout_json=excluded.layout_json, layout_version=excluded.layout_version, updated_at=datetime('now')`)
    .run(userId, dashboardId, JSON.stringify(layout), version)
}

// The dashboard registry (names + order) lives in one reserved row, so multiple
// named dashboards reuse the per-dashboardId layout storage with no new table.
export const DASH_INDEX = '__dashboards__'

export async function getDashboards(userId) {
  const r = sqlite.prepare('SELECT layout_json FROM user_dashboards WHERE user_id=? AND dashboard_id=?').get(userId, DASH_INDEX)
  if (!r) return null
  try { const d = JSON.parse(r.layout_json); return Array.isArray(d.dashboards) ? d.dashboards : null } catch { return null }
}

export async function saveDashboards(userId, dashboards) {
  sqlite.prepare(`INSERT INTO user_dashboards (user_id, dashboard_id, layout_json, layout_version, updated_at)
    VALUES (?,?,?,1,datetime('now'))
    ON CONFLICT(user_id, dashboard_id) DO UPDATE SET layout_json=excluded.layout_json, updated_at=datetime('now')`)
    .run(userId, DASH_INDEX, JSON.stringify({ dashboards }))
}

// Drop a dashboard's saved layout (the registry row is updated separately).
export async function deleteDashboardLayout(userId, dashboardId) {
  sqlite.prepare('DELETE FROM user_dashboards WHERE user_id=? AND dashboard_id=?').run(userId, dashboardId)
}

// Where the user's notes live: which CalDAV account + the folder path. (Notes
// themselves live in that Nextcloud folder, never in this DB.)
export async function getNotesConfig(userId) {
  const r = sqlite.prepare('SELECT account_id, root_path FROM notes_config WHERE user_id=?').get(userId)
  return r ? { accountId: r.account_id, rootPath: r.root_path } : null
}
export async function setNotesConfig(userId, accountId, rootPath) {
  sqlite.prepare(`INSERT INTO notes_config (user_id, account_id, root_path, updated_at) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET account_id=excluded.account_id, root_path=excluded.root_path, updated_at=datetime('now')`)
    .run(userId, accountId, rootPath)
}

// Reminder group -> calendar (caldav_lists.id) mapping: a group's reminders are
// stored in its mapped calendar. (The reminders live in CalDAV; only the small
// name->calendar map lives here.)
export async function getGroupMap(userId) {
  const out = {}
  for (const r of sqlite.prepare('SELECT group_name, list_id FROM group_calendars WHERE user_id=?').all(userId)) out[r.group_name] = r.list_id
  return out
}
export async function getGroupListId(userId, groupName) {
  const r = sqlite.prepare('SELECT list_id FROM group_calendars WHERE user_id=? AND group_name=?').get(userId, groupName)
  return r ? r.list_id : null
}
export async function setGroupMapping(userId, groupName, listId) {
  sqlite.prepare('INSERT INTO group_calendars (user_id, group_name, list_id) VALUES (?,?,?) ON CONFLICT(user_id, group_name) DO UPDATE SET list_id=excluded.list_id').run(userId, groupName, listId)
}
export async function deleteGroupMapping(userId, groupName) {
  sqlite.prepare('DELETE FROM group_calendars WHERE user_id=? AND group_name=?').run(userId, groupName)
}
export async function deleteListRow(accountId, url) {
  sqlite.prepare('DELETE FROM caldav_lists WHERE account_id=? AND url=?').run(accountId, url)
}

// ============================================================
//  CalDAV accounts
// ============================================================
export async function listAccounts(userId) {
  return sqlite.prepare('SELECT * FROM caldav_accounts WHERE user_id=? ORDER BY created_at').all(userId)
}
export async function getAccount(userId, id) {
  return sqlite.prepare('SELECT * FROM caldav_accounts WHERE id=? AND user_id=?').get(id, userId) || null
}
export async function insertAccount(acc) {
  sqlite.prepare('INSERT INTO caldav_accounts (id,user_id,name,type,server_url,username,password_enc) VALUES (?,?,?,?,?,?,?)')
    .run(acc.id, acc.user_id, acc.name, acc.type, acc.server_url, acc.username, acc.password_enc)
}
export async function deleteAccount(userId, id) {
  sqlite.prepare('DELETE FROM caldav_accounts WHERE id=? AND user_id=?').run(id, userId)
}
export async function deleteAccountById(id) {
  sqlite.prepare('DELETE FROM caldav_accounts WHERE id=?').run(id)
}
// Distinct users with at least one CalDAV account — the set the reminder poller sweeps.
export async function usersWithCaldav() {
  return sqlite.prepare('SELECT DISTINCT user_id FROM caldav_accounts').all().map((x) => x.user_id)
}

// ============================================================
//  CalDAV lists
// ============================================================
export async function upsertList(accountId, { url, displayName, color, supportsVtodo }) {
  sqlite.prepare(`INSERT INTO caldav_lists (account_id,url,display_name,color,supports_vtodo,enabled)
    VALUES (?,?,?,?,?,1)
    ON CONFLICT(account_id,url) DO UPDATE SET display_name=excluded.display_name, color=excluded.color, supports_vtodo=excluded.supports_vtodo`)
    .run(accountId, url, displayName, color, supportsVtodo ? 1 : 0)
}
export async function pruneLists(accountId, keepUrls) {
  if (!keepUrls || !keepUrls.length) return
  sqlite.prepare(`DELETE FROM caldav_lists WHERE account_id=? AND url NOT IN (${keepUrls.map(() => '?').join(',')})`).run(accountId, ...keepUrls)
}
export async function listsForAccount(accountId) {
  return sqlite.prepare('SELECT url, display_name, enabled FROM caldav_lists WHERE account_id=? ORDER BY display_name').all(accountId)
    .map((l) => ({ url: l.url, displayName: l.display_name, enabled: bool(l.enabled) }))
}
export async function enabledListsForAccount(accountId) {
  return sqlite.prepare('SELECT url, display_name FROM caldav_lists WHERE account_id=? AND enabled=1').all(accountId)
}
export async function setListEnabled(accountId, url, enabled) {
  sqlite.prepare('UPDATE caldav_lists SET enabled=? WHERE account_id=? AND url=?').run(enabled ? 1 : 0, accountId, url)
}

// Lists with their stable integer id (= project_id) AND their account creds, so
// the task store can fan out reads/writes without a second query per list.
export async function listsWithId(userId) {
  return sqlite.prepare(
    `SELECT l.id, l.url, l.display_name, l.color, l.supports_vtodo, l.enabled,
            a.id AS account_id, a.type AS account_type, a.server_url AS account_server_url,
            a.username AS account_username, a.password_enc AS account_password_enc
     FROM caldav_lists l JOIN caldav_accounts a ON a.id = l.account_id
     WHERE a.user_id = ? ORDER BY l.id`).all(userId)
    .map((r) => ({ ...r, supports_vtodo: bool(r.supports_vtodo), enabled: bool(r.enabled) }))
}

// Resolve a list id to { list, account } (ownership-checked) for CRUD.
export async function getListById(userId, listId) {
  const x = sqlite.prepare(
    `SELECT l.id AS list_id, l.url AS list_url, l.display_name, l.color, l.supports_vtodo, l.enabled,
            a.id AS account_id, a.user_id, a.name, a.type, a.server_url, a.username, a.password_enc
     FROM caldav_lists l JOIN caldav_accounts a ON a.id = l.account_id
     WHERE l.id = ? AND a.user_id = ?`).get(listId, userId)
  if (!x) return null
  return {
    list: { id: x.list_id, url: x.list_url, displayName: x.display_name, color: x.color, supportsVtodo: bool(x.supports_vtodo), enabled: bool(x.enabled) },
    account: { id: x.account_id, user_id: x.user_id, name: x.name, type: x.type, server_url: x.server_url, username: x.username, password_enc: x.password_enc },
  }
}

// ============================================================
//  Sessions
// ============================================================
export function createSessionStore() {
  const SqliteStore = sqliteStoreFactory(session)
  return new SqliteStore({ client: sqlite, expired: { clear: true, intervalMs: 15 * 60 * 1000 } })
}
