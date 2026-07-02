// server/mcp_validate.js — JSON-Schema-subset validator for MCP tool inputs.
// Run: node test/mcp_validate.test.mjs
import { validateInput } from '../server/mcp_validate.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Helper: assert result is ok with a value
const assertOk = (result, m) => ok(result.ok === true, m + ' [ok]')
// Helper: assert result is err and error message contains needle
const assertErr = (result, needle, m) => {
  ok(result.ok === false, m + ' [not ok]')
  ok(typeof result.error === 'string' && result.error.toLowerCase().includes(needle.toLowerCase()),
    m + ` [error mentions "${needle}" — got: ${result?.error}]`)
}

// -------------------------------------------------------------------------
// Minimal valid object
// -------------------------------------------------------------------------
const minSchema = { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false }
assertOk(validateInput(minSchema, { name: 'Alice' }), 'valid minimal object')
const r1 = validateInput(minSchema, { name: 'Alice' })
ok(r1.ok && r1.value.name === 'Alice', 'value.name is preserved')

// -------------------------------------------------------------------------
// undefined args treated as {} — valid when no required fields
// -------------------------------------------------------------------------
assertOk(validateInput(minSchema, undefined), 'undefined args with no required -> ok')
const r2 = validateInput(minSchema, undefined)
ok(r2.ok && Object.keys(r2.value).length === 0, 'undefined args -> empty value object')

// undefined args fails when required present
const reqSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  additionalProperties: false
}
assertErr(validateInput(reqSchema, undefined), 'id', 'undefined args with required field -> error mentioning key')

// -------------------------------------------------------------------------
// Missing required field
// -------------------------------------------------------------------------
assertErr(validateInput(reqSchema, {}), 'id', 'missing required -> error mentions field name')
assertErr(validateInput(reqSchema, { id: undefined }), 'id', 'undefined required value -> error mentions field name')

// -------------------------------------------------------------------------
// Unknown keys rejected and named
// -------------------------------------------------------------------------
const r3 = validateInput(minSchema, { name: 'Alice', extra: 'oops' })
ok(r3.ok === false, 'unknown key -> not ok')
ok(r3.error.toLowerCase().includes('extra'), 'unknown key error mentions "extra"')

// Multiple unknown keys
const r4 = validateInput(minSchema, { foo: 1, bar: 2 })
ok(r4.ok === false && r4.error.toLowerCase().includes('foo') && r4.error.toLowerCase().includes('bar'),
  'multiple unknown keys both named in error')

// -------------------------------------------------------------------------
// Absent optional properties left absent in value (no default injection)
// -------------------------------------------------------------------------
const optSchema = {
  type: 'object',
  properties: { a: { type: 'string' }, b: { type: 'number' } },
  additionalProperties: false
}
const r5 = validateInput(optSchema, { a: 'hello' })
ok(r5.ok && r5.value.a === 'hello', 'present optional property is in value')
ok(r5.ok && !('b' in r5.value), 'absent optional property is NOT injected into value')

// -------------------------------------------------------------------------
// Type: string — basic + constraints
// -------------------------------------------------------------------------
const strSchema = {
  type: 'object',
  properties: {
    s: { type: 'string', minLength: 2, maxLength: 5, enum: ['hi', 'hey', 'hello'], pattern: '^h' }
  },
  additionalProperties: false
}
assertOk(validateInput(strSchema, { s: 'hi' }), 'string passing all constraints')
assertErr(validateInput(strSchema, { s: 42 }), 's', 'wrong type for string property names property')
assertErr(validateInput(strSchema, { s: 'a' }), 's', 'string too short names property')
assertErr(validateInput(strSchema, { s: 'toolong' }), 's', 'string too long names property')
assertErr(validateInput(strSchema, { s: 'foo' }), 's', 'string not in enum names property')
// pattern check (enum is checked first in our impl, so use a schema without enum)
const patSchema = {
  type: 'object',
  properties: { s: { type: 'string', pattern: '^\\d+$' } },
  additionalProperties: false
}
assertErr(validateInput(patSchema, { s: 'abc' }), 's', 'string not matching pattern names property')
assertOk(validateInput(patSchema, { s: '123' }), 'string matching pattern passes')

// -------------------------------------------------------------------------
// Type: number
// -------------------------------------------------------------------------
const numSchema = {
  type: 'object',
  properties: { n: { type: 'number', minimum: 1, maximum: 10 } },
  additionalProperties: false
}
assertOk(validateInput(numSchema, { n: 5 }), 'number within bounds')
assertOk(validateInput(numSchema, { n: 1.5 }), 'number allows float')
assertErr(validateInput(numSchema, { n: 'x' }), 'n', 'wrong type for number names property')
assertErr(validateInput(numSchema, { n: 0 }), 'n', 'number below minimum names property')
assertErr(validateInput(numSchema, { n: 11 }), 'n', 'number above maximum names property')

// -------------------------------------------------------------------------
// Type: integer — rejects floats
// -------------------------------------------------------------------------
const intSchema = {
  type: 'object',
  properties: { i: { type: 'integer', minimum: 0, maximum: 100 } },
  additionalProperties: false
}
assertOk(validateInput(intSchema, { i: 5 }), 'integer 5 is valid')
assertOk(validateInput(intSchema, { i: 0 }), 'integer 0 at minimum is valid')
assertOk(validateInput(intSchema, { i: 100 }), 'integer 100 at maximum is valid')
assertErr(validateInput(intSchema, { i: 1.5 }), 'i', 'integer rejects 1.5 and names property')
assertErr(validateInput(intSchema, { i: -1 }), 'i', 'integer below minimum names property')
assertErr(validateInput(intSchema, { i: 101 }), 'i', 'integer above maximum names property')
assertErr(validateInput(intSchema, { i: 'five' }), 'i', 'wrong type for integer names property')

// -------------------------------------------------------------------------
// Type: boolean
// -------------------------------------------------------------------------
const boolSchema = {
  type: 'object',
  properties: { flag: { type: 'boolean' } },
  additionalProperties: false
}
assertOk(validateInput(boolSchema, { flag: true }), 'boolean true passes')
assertOk(validateInput(boolSchema, { flag: false }), 'boolean false passes')
assertErr(validateInput(boolSchema, { flag: 'true' }), 'flag', 'string "true" fails boolean check and names property')
assertErr(validateInput(boolSchema, { flag: 1 }), 'flag', 'number 1 fails boolean check and names property')

// -------------------------------------------------------------------------
// Type: array — items type + maxItems
// -------------------------------------------------------------------------
const arrSchema = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 }
  },
  additionalProperties: false
}
assertOk(validateInput(arrSchema, { tags: ['a', 'b'] }), 'string array passes')
assertOk(validateInput(arrSchema, { tags: [] }), 'empty array passes')
assertErr(validateInput(arrSchema, { tags: 'notarray' }), 'tags', 'non-array fails and names property')
assertErr(validateInput(arrSchema, { tags: ['a', 'b', 'c', 'd'] }), 'tags', 'array exceeds maxItems and names property')
assertErr(validateInput(arrSchema, { tags: ['a', 2, 'c'] }), 'tags', 'array with wrong item type names property')

// -------------------------------------------------------------------------
// Nullable types — type: ['string', 'null']
// -------------------------------------------------------------------------
const nullSchema = {
  type: 'object',
  properties: {
    opt: { type: ['string', 'null'] },
    req: { type: 'string' }
  },
  required: ['req'],
  additionalProperties: false
}
assertOk(validateInput(nullSchema, { req: 'hi', opt: null }), 'null is valid for nullable field')
assertOk(validateInput(nullSchema, { req: 'hi', opt: 'text' }), 'string is valid for nullable field')
assertOk(validateInput(nullSchema, { req: 'hi' }), 'absent nullable optional field passes')
assertErr(validateInput(nullSchema, { req: 'hi', opt: 42 }), 'opt', 'wrong non-null type for nullable field names property')
// Non-nullable field rejects null
const strictSchema = {
  type: 'object',
  properties: { s: { type: 'string' } },
  additionalProperties: false
}
assertErr(validateInput(strictSchema, { s: null }), 's', 'null rejected for non-nullable field names property')

// -------------------------------------------------------------------------
// Full schema combining all features
// -------------------------------------------------------------------------
const fullSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    score: { type: 'number', minimum: 0.0, maximum: 1.0 },
    active: { type: 'boolean' },
    role: { type: 'string', enum: ['admin', 'user', 'guest'] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    note: { type: ['string', 'null'] }
  },
  required: ['name', 'active'],
  additionalProperties: false
}
const fullValid = { name: 'Bob', age: 30, score: 0.95, active: true, role: 'admin', tags: ['a'], note: null }
assertOk(validateInput(fullSchema, fullValid), 'full valid object passes')
const rfull = validateInput(fullSchema, fullValid)
ok(rfull.ok && rfull.value.name === 'Bob' && rfull.value.note === null, 'full valid: value preserved correctly')

// Missing both required fields
const rMissing = validateInput(fullSchema, { age: 25 })
ok(rMissing.ok === false, 'missing required in full schema -> not ok')

// -------------------------------------------------------------------------
// Error messages mention the offending key (spot-check a few)
// -------------------------------------------------------------------------
const ekSchema = {
  type: 'object',
  properties: {
    alpha: { type: 'string' },
    beta: { type: 'integer' }
  },
  required: ['alpha'],
  additionalProperties: false
}
const eMissing = validateInput(ekSchema, {})
ok(eMissing.ok === false && eMissing.error.includes('alpha'), 'missing required error mentions "alpha"')
const eType = validateInput(ekSchema, { alpha: 'ok', beta: 'wrong' })
ok(eType.ok === false && eType.error.includes('beta'), 'type error mentions "beta"')
const eUnknown = validateInput(ekSchema, { alpha: 'ok', gamma: 1 })
ok(eUnknown.ok === false && eUnknown.error.includes('gamma'), 'unknown key error mentions "gamma"')

// -------------------------------------------------------------------------
// Never throws on bad args (only bad schema may throw)
// -------------------------------------------------------------------------
let threw = false
try {
  validateInput(minSchema, 'not-an-object')
  validateInput(minSchema, 42)
  validateInput(minSchema, [])
  validateInput(minSchema, null)
} catch {
  threw = true
}
ok(!threw, 'validateInput does not throw on non-object args')
// And each non-object rejects with a clean error rather than validating as {}.
ok(validateInput(minSchema, 'not-an-object').ok === false, 'a string arg fails cleanly')
ok(validateInput(minSchema, []).ok === false, 'an array arg fails cleanly')

console.log(`\nmcp_validate.test: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
