// Integration test for the SQLite branch of the config repo. Uses a real
// better-sqlite3 file in a temp dir — no cluster needed. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite \
//     -e CONFIG_DB_PATH=/tmp/cfg.test.db node:22 node test/config.sqlite.test.mjs
import { rmSync } from 'node:fs'

process.env.CONFIG_STORE = 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/cfg.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const cfg = await import('../server/config.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const U = 'sub-alice', U2 = 'sub-bob'

// --- accounts ---
await cfg.insertAccount({ id: 'ca-1', user_id: U, name: 'NC', type: 'nextcloud', server_url: 'https://nc/remote.php/dav', username: 'alice', password_enc: 'ENC' })
await cfg.insertAccount({ id: 'ca-2', user_id: U2, name: 'NC2', type: 'nextcloud', server_url: 'https://nc/remote.php/dav', username: 'bob', password_enc: 'ENC2' })
ok((await cfg.listAccounts(U)).length === 1, 'listAccounts is per-user (alice sees only her account)')
ok((await cfg.getAccount(U, 'ca-1'))?.password_enc === 'ENC', 'getAccount returns the row incl password_enc')
ok((await cfg.getAccount(U, 'ca-2')) === null, 'getAccount is ownership-scoped (alice cannot read bob)')
ok((await cfg.usersWithCaldav()).sort().join(',') === [U, U2].sort().join(','), 'usersWithCaldav lists both users')

// --- lists (project ids) ---
await cfg.upsertList('ca-1', { url: 'https://nc/cal/tasks/', displayName: 'Tasks', color: '#f00', supportsVtodo: true })
await cfg.upsertList('ca-1', { url: 'https://nc/cal/events/', displayName: 'Events', color: '#00f', supportsVtodo: false })
const withId = await cfg.listsWithId(U)
ok(withId.length === 2, 'listsWithId returns both lists')
ok(withId.every((l) => Number.isInteger(l.id) && l.id > 0), 'each list got an integer project id')
ok(withId[0].id !== withId[1].id, 'project ids are distinct')
ok(typeof withId[0].supports_vtodo === 'boolean' && typeof withId[0].enabled === 'boolean', 'booleans are coerced from SQLite ints')
ok(withId.find((l) => l.url.endsWith('events/')).supports_vtodo === false, 'supports_vtodo=false round-trips')
ok(withId[0].account_password_enc === 'ENC', 'listsWithId carries account creds for fan-out')

// upsert is idempotent on (account_id,url): updates, never duplicates
await cfg.upsertList('ca-1', { url: 'https://nc/cal/tasks/', displayName: 'Tasks Renamed', color: '#0f0', supportsVtodo: true })
const afterUpsert = await cfg.listsWithId(U)
ok(afterUpsert.length === 2, 'upsert on same url does not duplicate')
ok(afterUpsert.find((l) => l.url.endsWith('tasks/')).display_name === 'Tasks Renamed', 'upsert updates display_name')

const tasksList = afterUpsert.find((l) => l.url.endsWith('tasks/'))
const resolved = await cfg.getListById(U, tasksList.id)
ok(resolved?.list?.id === tasksList.id && resolved.account.id === 'ca-1', 'getListById resolves list+account')
ok(resolved.list.supportsVtodo === true && typeof resolved.list.enabled === 'boolean', 'getListById coerces booleans')
ok((await cfg.getListById(U2, tasksList.id)) === null, 'getListById is ownership-scoped')

// enabled toggling
await cfg.setListEnabled('ca-1', 'https://nc/cal/events/', false)
ok((await cfg.enabledListsForAccount('ca-1')).length === 1, 'enabledListsForAccount honors the toggle')
const lf = await cfg.listsForAccount('ca-1')
ok(lf.length === 2 && lf.every((l) => 'enabled' in l && typeof l.enabled === 'boolean'), 'listsForAccount returns coerced enabled')

// prune drops lists not in the keep-set
await cfg.pruneLists('ca-1', ['https://nc/cal/tasks/'])
ok((await cfg.listsWithId(U)).length === 1, 'pruneLists removes lists absent from the keep-set')
await cfg.pruneLists('ca-1', []) // empty keep-set is a no-op (never wipes everything)
ok((await cfg.listsWithId(U)).length === 1, 'pruneLists([]) is a no-op')

// --- layouts ---
await cfg.saveLayout(U, 'main', { layout: { version: 2, widgets: [{ i: 'w1', type: 'tasklist', projectId: tasksList.id }], layouts: { lg: [{ i: 'w1', x: 0, y: 0, w: 4, h: 8 }] } } })
const got = await cfg.getLayout(U, 'main')
ok(got.layout?.widgets?.[0]?.i === 'w1' && got.version === 2, 'layout round-trips with version')
ok((await cfg.getLayout(U, 'missing')).layout === null, 'missing layout returns {layout:null}')

// --- dashboard registry (multi-dashboard switcher; reuses user_dashboards) ---
ok((await cfg.getDashboards(U)) === null, 'getDashboards is null before any are saved')
await cfg.saveDashboards(U, [{ id: 'main', name: 'Home' }, { id: 'd-2', name: 'Work' }])
const dl = await cfg.getDashboards(U)
ok(Array.isArray(dl) && dl.length === 2 && dl[1].name === 'Work', 'getDashboards round-trips the saved list')
ok((await cfg.getDashboards(U2)) === null, 'dashboard registry is per-user')
await cfg.saveLayout(U, 'd-2', { layout: { version: 1, widgets: [], layouts: {} } })
ok((await cfg.getLayout(U, 'd-2')).layout !== null, 'a per-dashboard layout saves under its id')
await cfg.deleteDashboardLayout(U, 'd-2')
ok((await cfg.getLayout(U, 'd-2')).layout === null, 'deleteDashboardLayout removes that dashboard layout')
ok((await cfg.getDashboards(U)).length === 2, 'deleting a layout leaves the registry row untouched')

// --- cascade delete (FK ON DELETE CASCADE) ---
await cfg.deleteAccount(U, 'ca-1')
ok((await cfg.getAccount(U, 'ca-1')) === null, 'deleteAccount removes the account')
ok((await cfg.listsWithId(U)).length === 0, 'deleting an account cascades to its lists')

// --- only config tables exist (no task/reminder data lives in the DB) ---
const tables = cfg.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name).sort()
const expected = ['caldav_accounts', 'caldav_lists', 'user_dashboards']
ok(expected.every((t) => tables.includes(t)) && !tables.some((t) => /task|reminder|project|label/i.test(t)),
  'schema holds only config/layout tables — no task/reminder/project/label tables: [' + tables.join(', ') + ']')

console.log(`\nconfig.sqlite.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
