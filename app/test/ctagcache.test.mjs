// The pure cache-reuse decision behind the CalDAV ctag gating (tasks_caldav.js):
// 'fresh' reuses with no network, 'ctag' probes the collection ctag first, and
// 'report' does the full REPORT. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite \
//     -e CONFIG_DB_PATH=/tmp/ctagcache.test.db node:22 node test/ctagcache.test.mjs
import { rmSync } from 'node:fs'

// Importing tasks_caldav.js transitively imports config.js, which opens SQLite at
// import time — point it at a throwaway file (the decision under test is pure and
// never touches it), and set this BEFORE the dynamic import below so it takes hold.
process.env.CONFIG_STORE = process.env.CONFIG_STORE || 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/ctagcache.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
const { cacheDecision } = await import('../server/tasks_caldav.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const TTL = 12000
const entry = (at, ctag) => ({ at, ctag, parsed: [] })

ok(cacheDecision(null, 1000, TTL) === 'report', 'no entry -> report (cold)')
ok(cacheDecision(entry(1000, 'abc'), 1000 + 5000, TTL) === 'fresh', 'within TTL -> fresh (no network)')
ok(cacheDecision(entry(1000, 'abc'), 1000 + TTL - 1, TTL) === 'fresh', 'just inside TTL -> fresh')
ok(cacheDecision(entry(1000, 'abc'), 1000 + TTL + 1, TTL) === 'ctag', 'past TTL with a ctag -> probe ctag')
ok(cacheDecision(entry(1000, null), 1000 + TTL + 1, TTL) === 'report', 'past TTL without a ctag -> report')
ok(cacheDecision(entry(1000, ''), 1000 + TTL + 1, TTL) === 'report', 'past TTL, empty ctag treated as none -> report')

console.log(`\nctagcache.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
