// Boot-time cache warm-up: background-fire the VTODO read (tasks_caldav.js's
// allUserVtodos, which fans out across every enabled list) for every user
// with >=1 CalDAV account, so the widget stampede on the very first dashboard
// load after a deploy/restart doesn't pay the full cold REPORT fan-out.
//
// With VALKEY_URL set, this warms the shared persistent cache, so even a
// SECOND pod restart is warm immediately (the read-through path in
// tasks_caldav.js hydrates from Valkey and only pays a cheap ctag PROPFIND).
// Without it, this only warms THIS process's in-memory cache — still a win
// for the first real user request, but lost again on the next restart.
//
// Bounded concurrency keeps the warm-up from becoming the very stampede it's
// meant to prevent (a large multi-tenant deploy shouldn't open N CalDAV
// connections simultaneously at boot); a small delay + jitter gives the
// server a moment to finish binding/settling before adding load, and staggers
// multiple pods restarting together (e.g. a rolling update... though this app
// is Recreate/single-replica — jitter still helps against a crash-loop).
// Fully fire-and-forget: a down CalDAV server, a config read error, or
// anything else here must never affect server startup or liveness.
import { usersWithCaldav } from './config.js'
import { allUserVtodos } from './tasks_caldav.js'

const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.PREWARM_CONCURRENCY) || 3))
const BASE_DELAY_MS = Math.max(0, Number(process.env.PREWARM_DELAY_MS) || 2000)
const JITTER_MS = 1500

// Exported so tests can drive the scheduling/concurrency policy without a
// real CalDAV account or timers.
export async function runPrewarmPool(subs, concurrency, warmOne) {
  let i = 0
  const results = []
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, subs.length)) }, async () => {
    while (i < subs.length) {
      const sub = subs[i++]
      try { await warmOne(sub); results.push({ sub, ok: true }) }
      catch (e) { results.push({ sub, ok: false, error: e }) } // a down/unreachable account just stays cold
    }
  })
  await Promise.all(workers)
  return results
}

function truthyEnv(v, defaultOn) {
  if (v === undefined || v === '') return defaultOn
  return !(v === '0' || v.toLowerCase() === 'false')
}

export function prewarmOnBoot({ logger = console } = {}) {
  if (!truthyEnv(process.env.PREWARM_ON_BOOT, true)) {
    logger.log('cache prewarm on boot disabled (PREWARM_ON_BOOT=0)')
    return
  }
  const delay = BASE_DELAY_MS + Math.floor(Math.random() * JITTER_MS)
  const timer = setTimeout(() => {
    usersWithCaldav()
      .then((subs) => {
        if (!subs.length) { logger.log('cache prewarm on boot: no CalDAV users to warm'); return }
        logger.log(`cache prewarm on boot: warming ${subs.length} user(s), concurrency ${CONCURRENCY}`)
        return runPrewarmPool(subs, CONCURRENCY, (sub) => allUserVtodos(sub)).then((results) => {
          const failed = results.filter((r) => !r.ok).length
          logger.log(`cache prewarm on boot complete: ${results.length - failed}/${results.length} warmed`)
        })
      })
      .catch((e) => logger.error('cache prewarm on boot failed:', e?.message || e))
  }, delay)
  timer.unref?.()
}
