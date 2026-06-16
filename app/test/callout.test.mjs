// Tests for the callout helpers (client/src/editor/callout.js). Pure module.
// Run with:
//   docker run --rm -v "$PWD":/app -w /app node:22 node test/callout.test.mjs
import { CALLOUT_TYPES, normalizeCalloutType, calloutLabel, parseCalloutHeader, calloutHeaderLine, stripCalloutHeader } from '../client/src/editor/callout.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

ok(CALLOUT_TYPES.includes('note') && CALLOUT_TYPES.includes('warning'), 'known types present')
ok(normalizeCalloutType('TIP') === 'tip', 'normalize lowercases a known type')
ok(normalizeCalloutType('bogus') === 'note', 'unknown type falls back to note')
ok(calloutLabel('warning') === 'Warning', 'label for a type')

ok(parseCalloutHeader('[!TIP]').type === 'tip', 'parse a header')
ok(parseCalloutHeader('[!TIP] Some title').type === 'tip', 'parse a header with trailing title')
ok(parseCalloutHeader('[!BOGUS]').type === 'note', 'unknown header type -> note')
ok(parseCalloutHeader('just text') === null, 'non-header returns null')
ok(parseCalloutHeader('') === null, 'empty returns null')

ok(calloutHeaderLine('warning') === '[!WARNING]', 'header line is uppercased')
ok(parseCalloutHeader(calloutHeaderLine('danger')).type === 'danger', 'header line round-trips through parse')

ok(stripCalloutHeader('[!NOTE] hello') === 'hello', 'strip header leaves body')
ok(stripCalloutHeader('[!NOTE]') === '', 'strip header-only line -> empty')
ok(stripCalloutHeader('no header here') === 'no header here', 'strip leaves a non-header untouched')

console.log(`\ncallout.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
