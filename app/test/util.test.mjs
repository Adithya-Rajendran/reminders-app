// server/util.js — focuses on sanitizeCalDAVError: it must keep the HTTP status
// and a coarse class but NEVER echo the raw error message (response bodies can
// carry usernames / internal hosts / IPs / credentials). Run: node test/util.test.mjs
import { sanitizeCalDAVError } from '../server/util.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Status is kept; the message body (with an IP + username) is never echoed.
const s1 = sanitizeCalDAVError({ status: 403, message: 'Forbidden at 10.20.0.240 for user alice' }, 'createEvent')
ok(s1 === 'CalDAV createEvent failed (HTTP 403)', 'keeps status, drops the message body')
ok(!s1.includes('10.20.0.240') && !s1.includes('alice'), 'no IP / username leaks')

// Auth tokens in the message never surface.
const s2 = sanitizeCalDAVError({ message: 'Authorization: Basic dXNlcjpwYXNz rejected' }, 'discover')
ok(!s2.includes('dXNlcjpwYXNz') && !s2.toLowerCase().includes('authorization'), 'no auth token leak')

// A 4KB XML body is not echoed (length stays tiny).
const body = '<d:error><s:message>secret-host.internal</s:message></d:error>'.repeat(80)
const s3 = sanitizeCalDAVError({ status: 502, message: body }, 'fetchTasks')
ok(s3 === 'CalDAV fetchTasks failed (HTTP 502)' && !s3.includes('secret-host'), 'big XML body dropped')

// Coarse class when there's no HTTP status.
ok(sanitizeCalDAVError({ name: 'AbortError', message: 'The operation was aborted' }, 'fetchEvents') === 'CalDAV fetchEvents failed (timeout)', 'timeout class')
ok(sanitizeCalDAVError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND host' }, 'discover') === 'CalDAV discover failed (network)', 'network class')
ok(sanitizeCalDAVError(new Error('weird'), 'op') === 'CalDAV op failed', 'no status, no class -> bare')

console.log(`\nutil.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
