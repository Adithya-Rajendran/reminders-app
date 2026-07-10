// server/prewarm.js's pure pool runner: bounded concurrency, per-item error
// isolation (one down account never blocks the others), and that every
// subject gets warmed exactly once. The env-gated scheduling wrapper
// (prewarmOnBoot) is a thin setTimeout shell around this and isn't re-tested
// here. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite \
//     -e CONFIG_DB_PATH=/tmp/prewarm.test.db node:22 node test/prewarm.test.mjs
import { rmSync } from 'node:fs'

// prewarm.js transitively imports tasks_caldav.js -> config.js, which opens
// SQLite at import time — point it at a throwaway file (nothing under test
// here touches it; runPrewarmPool is pure and takes its own warmOne).
process.env.CONFIG_STORE = process.env.CONFIG_STORE || 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/prewarm.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })

const { runPrewarmPool } = await import('../server/prewarm.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- concurrency is bounded: never more than N warmOne calls in flight ---
{
  const subs = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  let inFlight = 0, maxInFlight = 0
  const seen = []
  const warmOne = async (sub) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    seen.push(sub)
    inFlight--
  }
  const results = await runPrewarmPool(subs, 3, warmOne)
  ok(maxInFlight <= 3, `concurrency stayed <= 3 (was ${maxInFlight})`)
  ok(seen.length === subs.length && subs.every((s) => seen.includes(s)), 'every subject was warmed exactly once')
  ok(results.every((r) => r.ok), 'all results report success')
}

// --- one failing subject never blocks or fails the others ---
{
  const subs = ['ok1', 'bad', 'ok2', 'ok3']
  const warmOne = async (sub) => { if (sub === 'bad') throw new Error('down'); return sub }
  const results = await runPrewarmPool(subs, 2, warmOne)
  ok(results.length === 4, 'every subject produces a result, including the failing one')
  const bad = results.find((r) => r.sub === 'bad')
  ok(bad && !bad.ok && bad.error instanceof Error, 'the failing subject is reported as a failure with its error, not thrown')
  ok(results.filter((r) => r.ok).length === 3, 'the other three subjects still succeed')
}

// --- concurrency higher than the subject count doesn't spawn extra/idle workers or throw ---
{
  const results = await runPrewarmPool(['only-one'], 5, async (s) => s)
  ok(results.length === 1 && results[0].ok, 'a single subject with high concurrency still completes cleanly')
}

// --- an empty subject list resolves immediately with no results ---
{
  const results = await runPrewarmPool([], 3, async () => { throw new Error('should never run') })
  ok(Array.isArray(results) && results.length === 0, 'no subjects -> empty results, warmOne never called')
}

console.log(`prewarm: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
