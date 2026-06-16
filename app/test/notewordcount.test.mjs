// Tests for word count / reading time (client/src/notewordcount.js). Pure. Run:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/notewordcount.test.mjs
import { wordCount, readingTime, stripForCount } from '../client/src/notewordcount.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

ok(wordCount('') === 0, 'empty -> 0 words')
ok(wordCount('one two three') === 3, 'plain words')
ok(wordCount('# Heading\n\nSome text here') === 4, 'heading marker not counted (Heading + 3 words)')
ok(wordCount('- one\n- two\n- three') === 3, 'list markers not counted')
ok(wordCount('---\nid: 1\ntags: [a]\n---\nbody words here') === 3, 'frontmatter excluded')
ok(wordCount('text ```\nconst x = 1\nlots of code\n``` more') === 2, 'fenced code excluded (text + more)')
ok(wordCount('see [the docs](http://x.com/y)') === 3, 'link text counted, url not (see the docs)')
ok(wordCount('a [[Roadmap]] link') === 3, 'wikilink target counted as one word (a Roadmap link)')
ok(wordCount('**bold** and _italic_') === 3, 'emphasis markers stripped (bold and italic)')

ok(readingTime(0) === 1, 'reading time floors to 1 min')
ok(readingTime(200) === 1, '200 words ~ 1 min')
ok(readingTime(600) === 3, '600 words ~ 3 min')

ok(!stripForCount('---\nx: 1\n---\nhi').includes('x:'), 'stripForCount removes frontmatter')

console.log(`\nnotewordcount.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
