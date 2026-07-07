// Pixel-diff two capture steps: walk output/<A> and output/<B>, match files by
// relative path, pixelmatch each pair, write a <name>.diff.png next to a JSON
// summary, and print a sorted table. A dimension mismatch (e.g. a genuinely
// different-sized crop) is reported, not a crash — same for a file that only
// exists on one side (a widget added/removed between steps).
//
// Usage: node diff.mjs <stepA> <stepB>   (paths are relative to output/)
// Normally invoked via `run.sh --diff <stepA> <stepB>`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_ROOT = path.join(HERE, 'output')

const [stepA, stepB] = process.argv.slice(2)
if (!stepA || !stepB) { console.error('usage: diff.mjs <stepA> <stepB>'); process.exit(1) }
const dirA = path.join(OUTPUT_ROOT, stepA)
const dirB = path.join(OUTPUT_ROOT, stepB)
for (const [name, dir] of [[stepA, dirA], [stepB, dirB]]) {
  if (!fs.existsSync(dir)) { console.error(`FATAL: no such step "${name}" (looked in ${dir})`); process.exit(1) }
}

function walkPngs(root) {
  const out = []
  ;(function rec(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) rec(p)
      else if (ent.isFile() && ent.name.endsWith('.png') && !ent.name.endsWith('.diff.png')) out.push(path.relative(root, p))
    }
  })(root)
  return out
}

const filesA = new Set(walkPngs(dirA))
const filesB = new Set(walkPngs(dirB))
const allFiles = [...new Set([...filesA, ...filesB])].sort()

const diffRoot = path.join(OUTPUT_ROOT, `diff-${stepA}-vs-${stepB}`)
const results = []

for (const rel of allFiles) {
  if (!filesA.has(rel)) { results.push({ file: rel, status: 'only-in-b' }); continue }
  if (!filesB.has(rel)) { results.push({ file: rel, status: 'only-in-a' }); continue }
  const a = PNG.sync.read(fs.readFileSync(path.join(dirA, rel)))
  const b = PNG.sync.read(fs.readFileSync(path.join(dirB, rel)))
  if (a.width !== b.width || a.height !== b.height) {
    results.push({ file: rel, status: 'dimension-mismatch', a: { w: a.width, h: a.height }, b: { w: b.width, h: b.height } })
    continue
  }
  const { width, height } = a
  const diffImg = new PNG({ width, height })
  const changed = pixelmatch(a.data, b.data, diffImg.data, width, height, { threshold: 0.1 })
  const pctChanged = (changed / (width * height)) * 100
  if (changed > 0) {
    const diffPath = path.join(diffRoot, rel.replace(/\.png$/, '.diff.png'))
    fs.mkdirSync(path.dirname(diffPath), { recursive: true })
    fs.writeFileSync(diffPath, PNG.sync.write(diffImg))
  }
  results.push({ file: rel, status: 'ok', pctChanged, changedPixels: changed, width, height })
}

fs.mkdirSync(diffRoot, { recursive: true })
const summary = { stepA, stepB, generatedAt: new Date().toISOString(), results }
fs.writeFileSync(path.join(diffRoot, 'summary.json'), JSON.stringify(summary, null, 2))

// Sorted table: non-"ok" statuses first (they need a human look regardless of
// %), then by pctChanged descending.
const rank = (r) => (r.status === 'ok' ? 1 : 0)
const sorted = [...results].sort((x, y) => rank(x) - rank(y) || (y.pctChanged || 0) - (x.pctChanged || 0))
const pad = (s, n) => String(s).padEnd(n)
console.log(`\n${stepA} vs ${stepB} — ${results.length} file(s) compared\n`)
console.log(pad('file', 60) + pad('status', 20) + '% changed')
for (const r of sorted) {
  const pct = r.status === 'ok' ? r.pctChanged.toFixed(3) : '-'
  console.log(pad(r.file, 60) + pad(r.status, 20) + pct)
}
const zeroDiff = results.every((r) => r.status === 'ok' && r.changedPixels === 0)
console.log(`\n${zeroDiff ? 'ZERO-DIFF' : 'DIFFS FOUND'} — summary: ${path.relative(HERE, path.join(diffRoot, 'summary.json'))}\n`)
