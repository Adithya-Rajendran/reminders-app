// server/areas.js (the Projects & Areas registry) against a fresh temp SQLite DB.
// Runs in its own process (test/run.mjs), so setting CONFIG_DB_PATH before the
// dynamic import is safe. Run with:
//   CONFIG_DB_PATH=/tmp/areas.test.db node test/areas.test.mjs
import { rmSync } from 'node:fs'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/areas.test.db'
for (const s of ['', '-wal', '-shm']) rmSync(process.env.CONFIG_DB_PATH + s, { force: true })
const areas = await import('../server/areas.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }
const U = 'user-test'

ok((await areas.list(U)).length === 0, 'new user has no areas')

// create: trims name, sets fields, defaults status active, sorts sequentially
const a = await areas.create(U, { name: '  Launch v2  ', kind: 'project', color: '#8b5cf6' })
ok(a.id.startsWith('area-') && a.name === 'Launch v2' && a.kind === 'project' && a.color === '#8b5cf6' && a.status === 'active', 'create trims + sets fields, defaults active')
ok(a.sort === 0, 'first area sorts at 0')

const b = await areas.create(U, { name: 'Health', kind: 'area' })
ok(b.kind === 'area' && b.sort === 1, 'second area: kind=area, sort increments')

const c = await areas.create(U, { name: 'Client Acme', kind: 'nonsense' })
ok(c.kind === 'project', 'unknown kind falls back to project')

let threw = false
try { await areas.create(U, { name: '   ' }) } catch (e) { threw = e.status === 400 }
ok(threw, 'blank name -> 400')

ok((await areas.list(U)).map((x) => x.name).join(',') === 'Launch v2,Health,Client Acme', 'list ordered by sort')
ok((await areas.list('other-user')).length === 0, 'areas are per-user isolated')

// update
const up = await areas.update(U, a.id, { name: 'Launch v2.1', status: 'archived', kind: 'area' })
ok(up.name === 'Launch v2.1' && up.status === 'archived' && up.kind === 'area', 'update applies name/status/kind')
ok((await areas.list(U))[0].name === 'Launch v2.1', 'update persists')

let threw404 = false
try { await areas.update(U, 'area-missing', { name: 'x' }) } catch (e) { threw404 = e.status === 404 }
ok(threw404, 'update missing -> 404')

let threwBlank = false
try { await areas.update(U, a.id, { name: '' }) } catch (e) { threwBlank = e.status === 400 }
ok(threwBlank, 'update to blank name -> 400')

// remove
ok((await areas.remove(U, b.id)).ok === true, 'remove returns ok')
ok((await areas.list(U)).some((x) => x.id === b.id) === false, 'removed area is gone')

let threwRem = false
try { await areas.remove(U, 'area-missing') } catch (e) { threwRem = e.status === 404 }
ok(threwRem, 'remove missing -> 404')

console.log(`\nareas.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
