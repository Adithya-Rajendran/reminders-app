// MCP bearer-token primitives — generate, hash, and compare tokens.
//
// WHY unsalted SHA-256 (not bcrypt/scrypt): the token itself is 256 bits of
// CSPRNG output, which is preimage-proof by sheer entropy — bcrypt/scrypt
// exist to slow down dictionary attacks against low-entropy passwords, not
// against uniform random bitstrings. A plain SHA-256 keeps DB lookups O(1)
// via a UNIQUE index on the hash column, which bcrypt's per-row cost would
// eliminate.
//
// WHY the `mcp_` prefix: makes tokens greppable by secret-scanning tools
// (GitHub secret scanning, truffleHog, etc.) so an accidental commit or log
// leak is caught immediately.
//
// WHY show-once: the plaintext token is returned only from generateToken()
// and must never be stored server-side. Only the hash is persisted. If a
// token is lost, the user rotates it.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Returns { token, hash }.
// token = 'mcp_' + 32 random bytes encoded as base64url (43 chars + prefix = 47 chars total).
// hash  = sha256 hex of the full token string (stored in DB; never the plaintext).
export function generateToken() {
  const token = 'mcp_' + randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

// Deterministic: same input always yields same 64-char hex string.
export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// Constant-time comparison of two SHA-256 hex strings (both must be 64 chars).
// Returns false immediately (short-circuit, safe: length is public) when lengths
// differ — timing attacks require equal-length inputs.
// Never throws, even on garbage input.
export function hashesEqual(aHex, bHex) {
  try {
    if (typeof aHex !== 'string' || typeof bHex !== 'string') return false
    if (aHex.length !== bHex.length) return false
    const a = Buffer.from(aHex, 'utf8')
    const b = Buffer.from(bHex, 'utf8')
    // timingSafeEqual requires same byte length; we've already checked string length
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
