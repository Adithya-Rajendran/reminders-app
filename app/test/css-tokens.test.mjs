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
// THEME PRESET ([data-palette]) COMPLETENESS (host/palettes.js, Wave 3)
//   Every non-default preset in PALETTES gets a `[data-palette="<key>"]`
//   block (dark base) and a `[data-palette="<key>"][data-theme="light"]`
//   companion in styles.css. Both must EXPLICITLY declare the full set of
//   "palette-relevant" custom properties — derived from what the default
//   (`:root, [data-theme="dark"]`) block itself declares, minus tokens that
//   are either pure var()-aliases of other tokens (they re-resolve
//   automatically — no redeclaration needed) or shared app-chrome constants
//   with no visual-identity role (spacing/z-index/type-scale/etc — see
//   PALETTE_DERIVED/PALETTE_STRUCTURAL below). A token missing from a preset
//   block doesn't error — it silently falls through to the DEFAULT preset's
//   value, which is exactly the "half-applied preset, one color bleeding
//   through" bug class this check exists to catch before a screenshot does.
//
// Run: `npm test` (auto-discovered) or directly with `node test/css-tokens.test.mjs`.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { PALETTES, DEFAULT_PALETTE } from '../client/src/host/palettes.js'

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

// ---- widget primitive boundary ----
// widget-sdk/ui/primitives.css is the ONLY place a .wg-* class may be
// DEFINED (the shared widget vocabulary — see the file's own header
// comment). A widget re-declaring `.wg-card { ... }` locally would silently
// shadow or drift from the shared definition, recreating exactly the "12
// local dialects" problem the primitives file exists to end.
//
// A widget file MAY still reference a wg- class to size/position it in its
// own layout — `.rem-widget .wg-toolrow { max-width: … }` is fine, that's
// context, not a redefinition — so the check is narrow: it only bans a
// selector that STARTS with `.wg-` (nothing scoping it), which is what
// declaring/overriding the primitive's own look looks like. This is a
// simple, low-false-positive heuristic, not full CSS parsing — paired with
// a review convention: a PR touching widgets/**/*.css that adds new shared-
// looking chrome should add it to primitives.css instead of a local class.
const PRIMITIVES_FILE = join(SRC_ROOT, 'widget-sdk/ui/primitives.css')
for (const file of cssFiles) {
  if (file === PRIMITIVES_FILE) continue
  const css = stripComments(readFileSync(file, 'utf8'))
  const rel = relKey(file)
  // Selectors are the text before each `{`, comma-separated. Splitting on
  // `}` first keeps this cheap and matches the file's existing informal
  // (non-AST) parsing style.
  const selectorLists = css.split('{').slice(0, -1).map((chunk) => {
    const lastBreak = Math.max(chunk.lastIndexOf('}'), chunk.lastIndexOf(';'))
    return chunk.slice(lastBreak + 1)
  })
  const offenders = new Set()
  for (const list of selectorLists) {
    for (const sel of list.split(',')) {
      const trimmed = sel.trim().replace(/\s+/g, ' ')
      if (/^\.wg-[\w-]+/.test(trimmed)) offenders.add(trimmed)
    }
  }
  ok(offenders.size === 0,
    `${rel}: declares a .wg-* selector locally (${[...offenders].join(', ')}) — ` +
    `.wg-* is the shared widget-sdk/ui/primitives.css vocabulary; add/extend the ` +
    `look there and reference it from JSX, don't redeclare it in a widget's own CSS`)
}

// ---- theme preset ([data-palette]) completeness ----
//
// Tokens declared in the default block that are pure var()-references to
// OTHER tokens in the same block (e.g. `--swatch-1: var(--accent)`,
// `--accent-grad: linear-gradient(135deg, var(--accent), var(--accent2))`) —
// these re-resolve against whatever a preset sets for --accent/etc without
// needing their own redeclaration, so they're not part of the required set.
const PALETTE_DERIVED = new Set(['--accent-grad', '--swatch-1', '--swatch-2', '--swatch-3', '--swatch-4', '--swatch-5'])
// Shared app-chrome constants (spacing scale, z-index scale, the general type
// ladder, canvas/measure caps, eyebrow tracking) — identical across every
// preset by design, not part of a preset's visual identity. --fs-stat* is the
// one type-scale exception (the "dial-face numerals" Wave 1/2 tokenized
// specifically so palettes COULD restate it) and stays required.
const PALETTE_STRUCTURAL = new Set([
  '--canvas-max', '--measure', '--tracking-eyebrow',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8',
  '--z-base', '--z-raised', '--z-sticky', '--z-dropdown', '--z-dropdown-lg',
  '--z-menu', '--z-popover', '--z-popover-lg', '--z-modal', '--z-devtools',
  '--fs-micro', '--fs-2xs', '--fs-meta', '--fs-ctrl', '--fs-body', '--fs-title', '--fs-lg', '--fs-modal', '--fs-display',
])

// Extract the { ... } body following the first match of `needle` in `css`,
// via brace-depth counting (declarations in this file never contain literal
// braces, so this is safe without a real CSS parser). Returns null if
// `needle` isn't found.
function blockBodyAfter(css, needle) {
  const at = css.indexOf(needle)
  if (at === -1) return null
  const open = css.indexOf('{', at)
  if (open === -1) return null
  let depth = 1
  let i = open + 1
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
  }
  return css.slice(open + 1, i - 1)
}

// Every `--custom-property` NAME declared directly in a block body (values
// ignored — this only checks presence, not correctness).
function customPropNames(block) {
  const names = new Set()
  const re = /(--[\w-]+)\s*:/g
  let m
  while ((m = re.exec(block))) names.add(m[1])
  return names
}

// Find every `[data-palette="<key>"]` rule (base + the `[data-theme="light"]`
// companion) in `css`, paired with its declared token names.
function findPaletteBlocks(css) {
  const out = []
  const re = /\[data-palette="([\w-]+)"\](\[data-theme="light"\])?\s*\{/g
  let m
  while ((m = re.exec(css))) {
    const openBrace = re.lastIndex - 1 // regex ends right after the '{' it matched
    let depth = 1
    let i = openBrace + 1
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
    }
    const body = css.slice(openBrace + 1, i - 1)
    out.push({ key: m[1], theme: m[2] ? 'light' : 'dark', tokens: customPropNames(body) })
  }
  return out
}

// Self-test the checker itself against a synthetic snippet, so a bug in
// blockBodyAfter/customPropNames/findPaletteBlocks can't silently pass every
// real preset by never actually detecting a gap. Plant a block missing one
// required token, confirm the miss is caught, then confirm the same block
// WITH the token present is clean — proves both the failure and success
// paths, not just "it didn't crash".
{
  const required = new Set(['--bg', '--accent'])
  const missingCase = findPaletteBlocks('[data-palette="synthetic-test"] { --bg: #000; }')
  const gotMissing = [...required].filter((t) => !missingCase[0]?.tokens.has(t))
  ok(missingCase.length === 1 && gotMissing.length === 1 && gotMissing[0] === '--accent',
    'palette-completeness self-test: planting a block missing --accent should be caught (it was not — the checker itself is broken)')

  const completeCase = findPaletteBlocks('[data-palette="synthetic-test"] { --bg: #000; --accent: #111; }')
  const gotComplete = [...required].filter((t) => !completeCase[0]?.tokens.has(t))
  ok(completeCase.length === 1 && gotComplete.length === 0,
    'palette-completeness self-test: a block declaring every required token should be clean (it was not — the checker itself is broken)')
}

const stylesFile = join(SRC_ROOT, 'styles.css')
if (existsSync(stylesFile)) {
  const rawStyles = readFileSync(stylesFile, 'utf8')
  const css = stripComments(rawStyles)
  const defaultBody = blockBodyAfter(css, ':root,')
  if (!defaultBody) {
    fail++
    console.error('  ✗ styles.css: could not locate the default `:root, [data-theme="dark"]` token block')
  } else {
    const requiredTokens = [...customPropNames(defaultBody)]
      .filter((t) => !PALETTE_DERIVED.has(t) && !PALETTE_STRUCTURAL.has(t))
      .sort()
    ok(requiredTokens.length > 20, `styles.css: derived an implausibly small required-token set (${requiredTokens.length}) — PALETTE_DERIVED/PALETTE_STRUCTURAL may be over-excluding`)

    const found = findPaletteBlocks(css)
    const nonDefaultPresets = PALETTES.filter((p) => p.key !== DEFAULT_PALETTE)

    for (const preset of nonDefaultPresets) {
      for (const theme of ['dark', 'light']) {
        const block = found.find((b) => b.key === preset.key && b.theme === theme)
        ok(block != null, `styles.css: missing [data-palette="${preset.key}"]${theme === 'light' ? '[data-theme="light"]' : ''} block for the "${preset.name}" preset (host/palettes.js)`)
        if (!block) continue
        const missing = requiredTokens.filter((t) => !block.tokens.has(t))
        ok(missing.length === 0,
          `styles.css: [data-palette="${preset.key}"]${theme === 'light' ? '[data-theme="light"]' : ''} is missing ${missing.length} required token(s): ${missing.join(', ')} — ` +
          `an omitted token silently falls back to the default (Paper Planner) preset's value instead of this preset's own identity`)
      }
    }
  }
} else {
  fail++
  console.error(`  ✗ ${stylesFile} not found`)
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
