// CSS token enforcement — hard bans + a shrink-only ratchet on raw literals.
//
// Scans every source .css file under client/src (Vite passes class names/CSS
// through untouched, so source == built for this purpose — no build step
// needed to check it).
//
// RATCHET CONTRACT (border-radius + font-size only — see note below)
//   `css-tokens.allowlist.json` is a per-file snapshot of every raw
//   `border-radius: <px...>` / `font-size: <px|em>` literal still in source,
//   keyed by exact value string, with a count of occurrences. A file fails
//   this test if it has a (value, count) pair that EXCEEDS what's allow-
//   listed, or a value that isn't in the allowlist at all — both mean a new
//   (or regressed) raw literal was introduced instead of a var(--r-*/--fs-*)
//   token. Declarations that resolve through var(--...) are exempt outright
//   — using a token IS the goal state, not something to track down.
//
//   Counts BELOW the allowlisted number are fine and expected: that's what
//   migrating a literal to a token looks like. When that happens, regenerate
//   the allowlist so the new, lower count becomes the new ceiling — it can
//   only shrink from here, never grow back:
//
//     node test/css-tokens.test.mjs --write-allowlist
//
//   Only regenerate after an INTENTIONAL migration; regenerating to silence
//   a real regression defeats the ratchet.
//
//   Spacing (padding/margin/gap) is deliberately NOT covered here — only
//   border-radius and font-size, matching the current token effort's scope
//   (--r-sm/lg/pill, --fs-*). Extend RATCHET_PROPS below if/when a --sp-*
//   migration wants the same treatment.
//
// HARD BANS (zero tolerance, never ratcheted — no legitimate use exists):
//   - `var(--token, #hex)` fallbacks — tokens must not hardcode a hex escape
//     hatch
//   - the removed tokens --blur / --density reappearing anywhere
//   - the dead selectors .widget-count, .gi, bare .grid (not .grid-wrap),
//     .habit, .habit-main, .habit-title — deleted as dead code (PR #141)
//
// Run: `npm test` (auto-discovered) or directly with `node test/css-tokens.test.mjs`.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(here, '../client/src')
const ALLOWLIST_PATH = join(here, 'css-tokens.allowlist.json')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- discover every .css file under client/src, stable order ----
function findCssFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findCssFiles(p))
    else if (entry.isFile() && entry.name.endsWith('.css')) out.push(p)
  }
  return out
}
const cssFiles = findCssFiles(SRC_ROOT).sort()

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// ---- hard bans: zero tolerance, checked against comment-stripped source ----
const BANS = [
  [/var\(--[\w-]+,\s*#/g, 'var(--token, #hex) fallback — tokens must not hardcode a hex fallback'],
  [/--blur(?![\w-])/g, 'the removed --blur token has reappeared'],
  [/--density(?![\w-])/g, 'the removed --density token has reappeared'],
  [/\.widget-count(?![\w-])/g, '.widget-count is dead code (removed in #141) — do not reintroduce'],
  [/\.gi(?![\w-])/g, '.gi is dead code (removed in #141) — do not reintroduce'],
  [/\.grid(?![\w-])/g, 'bare .grid is dead code (removed in #141; .grid-wrap is the real one) — do not reintroduce'],
  [/\.habit(?![\w-])/g, '.habit is dead code (removed in #141) — do not reintroduce'],
  [/\.habit-main(?![\w-])/g, '.habit-main is dead code (removed in #141) — do not reintroduce'],
  [/\.habit-title(?![\w-])/g, '.habit-title is dead code (removed in #141) — do not reintroduce'],
]

// ---- ratchet: property -> shape a raw (non-token) value must have to count ----
const RATCHET_PROPS = {
  'border-radius': /^\d+(?:\.\d+)?px(?:\s+\d+(?:\.\d+)?px){0,3}$/,
  'font-size': /^\d+(?:\.\d+)?(?:px|em)$/,
}

// Pull every `prop: value;` / `prop: value}` declaration's raw value out of
// comment-stripped CSS. Not brace-aware (doesn't need to be — CSS values in
// this codebase never contain literal `;`/`}`), so it works the same whether
// the declaration sits at top level or inside @media.
function declarationValues(css, prop) {
  const re = new RegExp(String.raw`\b${prop}\s*:\s*([^;{}]+?)\s*[;}]`, 'g')
  const values = []
  let m
  while ((m = re.exec(css))) {
    values.push(m[1].trim().replace(/\s*!important$/i, '').trim())
  }
  return values
}

// value -> count, restricted to values matching the property's ratchet shape
// (var(...)/calc(...)/%/keyword values are exempt — not tracked at all).
function countRatchetValues(css, prop) {
  const shape = RATCHET_PROPS[prop]
  const counts = {}
  for (const v of declarationValues(css, prop)) {
    if (!shape.test(v)) continue
    counts[v] = (counts[v] || 0) + 1
  }
  return counts
}

function relKey(absPath) {
  return relative(SRC_ROOT, absPath).split('\\').join('/')
}

function buildCurrentAllowlist() {
  const out = {}
  for (const file of cssFiles) {
    const css = stripComments(readFileSync(file, 'utf8'))
    const entry = {}
    for (const prop of Object.keys(RATCHET_PROPS)) {
      const counts = countRatchetValues(css, prop)
      if (Object.keys(counts).length) entry[prop] = counts
    }
    if (Object.keys(entry).length) out[relKey(file)] = entry
  }
  return out
}

// sort key: primary by leading numeric magnitude, then lexically — keeps
// "6px" before "10px" (unlike a plain string sort) while staying stable for
// multi-value shorthands like "5px 5px 2px 2px".
function sortedByValue(obj) {
  const lead = (v) => Number((v.match(/\d+(?:\.\d+)?/) || [0])[0])
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => lead(a) - lead(b) || a.localeCompare(b)),
  )
}

function sortedAllowlist(raw) {
  const out = {}
  for (const file of Object.keys(raw).sort()) {
    const entry = {}
    for (const prop of Object.keys(raw[file]).sort()) {
      entry[prop] = sortedByValue(raw[file][prop])
    }
    out[file] = entry
  }
  return out
}

function summarize(allowlist) {
  let files = 0, distinct = 0, total = 0
  for (const file of Object.keys(allowlist)) {
    files++
    for (const prop of Object.keys(allowlist[file])) {
      for (const v of Object.keys(allowlist[file][prop])) {
        distinct++
        total += allowlist[file][prop][v]
      }
    }
  }
  return { files, distinct, total }
}

// =============================================================================
// --write-allowlist: regenerate the JSON from the current tree and exit.
// =============================================================================
if (process.argv.includes('--write-allowlist')) {
  const allowlist = sortedAllowlist(buildCurrentAllowlist())
  writeFileSync(ALLOWLIST_PATH, JSON.stringify(allowlist, null, 2) + '\n')
  const s = summarize(allowlist)
  console.log(`css-tokens: wrote ${ALLOWLIST_PATH}`)
  console.log(`  ${s.files} file(s), ${s.distinct} distinct value(s), ${s.total} total occurrence(s)`)
  process.exit(0)
}

// =============================================================================
// Check mode
// =============================================================================

// ---- hard bans ----
for (const file of cssFiles) {
  const css = stripComments(readFileSync(file, 'utf8'))
  const rel = relKey(file)
  for (const [re, msg] of BANS) {
    const hits = css.match(re) || []
    ok(hits.length === 0, `${rel}: ${msg} (${hits.length} match(es))`)
  }
}

// ---- ratchet ----
let allowlist = {}
if (existsSync(ALLOWLIST_PATH)) {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'))
} else {
  console.error(`  ✗ ${ALLOWLIST_PATH} is missing — run \`node test/css-tokens.test.mjs --write-allowlist\` to create it`)
  fail++
}

const notes = []
for (const file of cssFiles) {
  const css = stripComments(readFileSync(file, 'utf8'))
  const rel = relKey(file)
  const allowedFile = allowlist[rel] || {}
  for (const prop of Object.keys(RATCHET_PROPS)) {
    const current = countRatchetValues(css, prop)
    const allowed = allowedFile[prop] || {}
    const values = new Set([...Object.keys(current), ...Object.keys(allowed)])
    for (const value of values) {
      const cur = current[value] || 0
      const cap = allowed[value] || 0
      ok(
        cur <= cap,
        `${rel}: ${prop}: ${value} — ${cur} occurrence(s) exceeds the allowlisted ${cap}` +
          (cap === 0 ? ' (not in the allowlist at all)' : '') +
          ' — use a token, or if intentional regenerate the allowlist',
      )
      if (cur < cap) {
        notes.push(`${rel}: ${prop}: ${value} — dropped from ${cap} to ${cur} (migration progress)`)
      }
    }
  }
}

if (notes.length) {
  console.log('  ℹ ' + notes.length + ' value(s) shrunk since the allowlist was last generated:')
  for (const n of notes) console.log('    · ' + n)
  console.log('    Regenerate with `node test/css-tokens.test.mjs --write-allowlist` to lock in the lower ceiling.')
}

console.log(`css-tokens: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
