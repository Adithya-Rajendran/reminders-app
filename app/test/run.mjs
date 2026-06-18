// Framework-free test runner: runs every test/*.test.mjs in its own node process,
// captures pass/fail, and prints one aggregated summary — so `npm test` is the
// single entry point (locally, in CI, and in the Docker `test` stage) instead of
// a bare shell loop that's hard to read and easy to get subtly wrong (a failing
// test in a `for` loop only aborts under `set -e`). Each test file is independent
// and self-asserting (it prints its own line and exits non-zero on failure); this
// just orchestrates and reports.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// Optional filter: `npm test -- contract` runs only files whose name matches.
const filter = process.argv[2] || ''
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(filter ? `No test files match "${filter}".` : 'No test files found.')
  process.exit(1)
}

const failed = []
const t0 = Date.now()
for (const f of files) {
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' })
  if (r.status !== 0) failed.push(f)
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log('\n' + '─'.repeat(48))
if (failed.length) {
  console.error(`✗ ${failed.length}/${files.length} test file(s) failed in ${secs}s: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`✓ all ${files.length} test files passed in ${secs}s`)
