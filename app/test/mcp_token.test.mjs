// server/mcp_token.js — token generation, hashing, constant-time compare.
// Run: node test/mcp_token.test.mjs
import { generateToken, hashToken, hashesEqual } from '../server/mcp_token.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// --- generateToken format ---
const { token, hash } = generateToken()

ok(token.startsWith('mcp_'), 'token has mcp_ prefix')

// base64url uses A-Z a-z 0-9 - _ (no +, /, =)
const payload = token.slice(4) // strip prefix
ok(payload.length > 0, 'payload is non-empty')
ok(/^[A-Za-z0-9_-]+$/.test(payload), 'payload is valid base64url (no +/=)')

// 32 random bytes -> 43 base64url chars (ceil(32*4/3) with no padding)
ok(payload.length === 43, 'payload is 43 base64url characters (32 bytes)')
ok(token.length === 47, 'full token is 47 characters (4 prefix + 43 payload)')

// --- uniqueness across 100 generations ---
const tokens = new Set()
for (let i = 0; i < 100; i++) tokens.add(generateToken().token)
ok(tokens.size === 100, '100 generated tokens are all unique')

// --- hashToken ---
ok(typeof hash === 'string', 'hash is a string')
ok(hash.length === 64, 'hash is 64 hex characters (SHA-256)')
ok(/^[0-9a-f]+$/.test(hash), 'hash contains only lowercase hex digits')

// Deterministic: same token -> same hash
ok(hashToken(token) === hash, 'hashToken is deterministic (same input same output)')
ok(hashToken(token) === hashToken(token), 'hashToken called twice gives same result')

// Different tokens -> different hashes (with overwhelming probability)
const { hash: h2 } = generateToken()
ok(hash !== h2, 'distinct tokens produce distinct hashes')

// --- roundtrip generate -> hashToken matches returned hash ---
const { token: t3, hash: h3 } = generateToken()
ok(hashToken(t3) === h3, 'roundtrip: hashToken(token) === returned hash')

// --- tamper detection ---
const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a')
ok(hashToken(tampered) !== hash, 'tampered token produces a different hash')

// --- hashesEqual ---
const { hash: hA } = generateToken()
const { hash: hB } = generateToken()

ok(hashesEqual(hA, hA) === true, 'hashesEqual: same hash equals itself')
ok(hashesEqual(hA, hB) === false, 'hashesEqual: distinct hashes are not equal')

// Length mismatch -> false (never throws)
ok(hashesEqual(hA, hA.slice(0, 32)) === false, 'hashesEqual: length mismatch -> false')
ok(hashesEqual('', hA) === false, 'hashesEqual: empty vs full -> false')
ok(hashesEqual('', '') === true, 'hashesEqual: both empty strings -> true (vacuous)')

// Garbage inputs -> never throws, returns false
ok(hashesEqual(null, hA) === false, 'hashesEqual: null first arg -> false, no throw')
ok(hashesEqual(hA, undefined) === false, 'hashesEqual: undefined second arg -> false, no throw')
ok(hashesEqual(null, null) === false, 'hashesEqual: both null -> false, no throw')
ok(hashesEqual(42, hA) === false, 'hashesEqual: non-string first arg -> false, no throw')
ok(hashesEqual(hA, {}) === false, 'hashesEqual: object second arg -> false, no throw')

// Correct positive: hash of same known value
const known = 'mcp_test_token'
ok(hashesEqual(hashToken(known), hashToken(known)) === true,
  'hashesEqual: hash of same string compares equal')

console.log(`\nmcp_token.test: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
