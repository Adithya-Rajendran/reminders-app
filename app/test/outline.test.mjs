// Tests for the heading outline extractor (client/src/outline.js). Pure. Run:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/outline.test.mjs
import { extractOutline } from '../client/src/outline.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

const o1 = extractOutline('# Title\n\ntext\n\n## Section A\n\n### Sub\n\n## Section B')
ok(o1.length === 4, 'extracts all headings')
ok(o1[0].level === 1 && o1[0].text === 'Title', 'level + text of h1')
ok(o1[2].level === 3 && o1[2].text === 'Sub', 'nested level')
ok(o1[1].slug === 'section-a', 'github-style slug')

ok(extractOutline('not a heading\n#nospace').length === 0, 'requires a space after #')
ok(extractOutline('####### too deep').length === 0, 'caps at h6')

const oc = extractOutline('# Real\n\n```\n# fake heading in code\n```\n\n## Also Real')
ok(oc.length === 2 && oc[1].text === 'Also Real', 'skips headings inside code fences')

const od = extractOutline('# Notes\n\n## Notes\n\n## Notes')
ok(od.map((h) => h.slug).join() === 'notes,notes-1,notes-2', 'de-duplicates slugs')

ok(extractOutline('## Trailing ##').length === 1 && extractOutline('## Trailing ##')[0].text === 'Trailing', 'strips closing ATX hashes')
ok(extractOutline('').length === 0, 'empty body -> no headings')

console.log(`\noutline.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
