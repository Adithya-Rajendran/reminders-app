// Characterization test for server/taskid.js — the opaque, URL-safe identifier
// codec for CalDAV tasks/labels. Locks the base64url("<listId>\x1f<objectUrl>")
// round-trip, the 400-on-malformed-id contract, and the "cat_"+base64url label
// scheme. Pure string/Buffer logic — no ical/DB imports. Run with:
//   docker run --rm -v /home/ubuntu/claude/reminders-app/app:/app -w /app -e CONFIG_STORE=sqlite -e CONFIG_DB_PATH=/tmp/taskid.test.db node:22 node test/taskid.test.mjs
import { encodeTaskId, decodeTaskId, encodeLabelId, decodeLabelId } from '../server/taskid.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Run fn, return the thrown error (or null if it did not throw).
const caught = (fn) => { try { fn(); return null } catch (e) { return e } }
// Assert fn throws an Error carrying .status === 400 (two genuine constraints).
const expect400 = (fn, label) => {
  const e = caught(fn)
  ok(e instanceof Error, label + ': throws an Error')
  ok(e != null && e.status === 400, label + ': caught error has .status === 400')
}

// --- A) round-trip: numeric listId + a normal CalDAV href ---
{
  const url = 'https://nc/cal/tasks/abc.ics'
  const r = decodeTaskId(encodeTaskId(7, url))
  ok(r.listId === 7, 'A: listId round-trips to 7')
  ok(typeof r.listId === 'number', 'A: decoded listId is a Number, not a string')
  ok(r.objectUrl === url, 'A: objectUrl round-trips byte-for-byte')
  ok(Object.keys(r).sort().join(',') === 'listId,objectUrl', 'A: decoded object has exactly {listId, objectUrl}')
}

// --- B) split is on the \x1f separator, never on a digit boundary ---
{
  const url = 'https://nc/9/0001.ics'
  const r = decodeTaskId(encodeTaskId(12, url))
  ok(r.listId === 12, 'B: multi-digit listId 12 survives a digit-laden URL')
  ok(r.objectUrl === url, 'B: full URL (incl. its own digits) is recovered, not truncated at a digit')
}

// --- C) the encoded id is URL-safe base64url, and deterministic ---
{
  const id = encodeTaskId(7, 'https://nc/cal/tasks/abc.ics')
  ok(/^[A-Za-z0-9_-]+$/.test(id), 'C: encoded id uses only base64url chars (no + / = whitespace)')
  ok(encodeTaskId(7, 'x') === encodeTaskId(7, 'x'), 'C: encoding is deterministic')
  // Exact value locks that the \x1f separator is embedded between listId and url.
  ok(encodeTaskId(7, 'a') === 'Nx9h', "C: encodeTaskId(7,'a') === base64url('7\\x1fa') === 'Nx9h'")
}

// --- D) decodeTaskId answers 400 on every malformed id ---
// (a) decoded payload has no \x1f separator
expect400(() => decodeTaskId(Buffer.from('noseparator', 'utf8').toString('base64url')), 'D(a) no separator')
// (b) listId must be a positive integer
expect400(() => decodeTaskId(encodeTaskId(0, 'u')), 'D(b) listId 0')
expect400(() => decodeTaskId(encodeTaskId(-1, 'u')), 'D(b) listId -1')
// (c) listId must be an integer
expect400(() => decodeTaskId(encodeTaskId('x', 'u')), 'D(c) non-integer listId')
// (d) objectUrl must be non-empty
expect400(() => decodeTaskId(encodeTaskId(5, '')), 'D(d) empty objectUrl')

// --- E) label ids: "cat_" + base64url(name), reversible ---
{
  const work = encodeLabelId('Work')
  ok(work.startsWith('cat_'), "E: encodeLabelId('Work') starts with 'cat_'")
  ok(work === 'cat_V29yaw', "E: encodeLabelId('Work') === 'cat_' + base64url('Work') === 'cat_V29yaw'")
  ok(decodeLabelId(work) === 'Work', "E: decodeLabelId round-trips 'Work'")
  const fancy = 'Déjà vu / 2'
  ok(decodeLabelId(encodeLabelId(fancy)) === fancy, 'E: unicode + space + slash name round-trips')
  // URL-safety: this name's bytes encode differently under base64 vs base64url
  // (plain base64 yields '/' and '=' padding), so the round-trip above — being a
  // symmetric decode — cannot tell the two apart. Pin base64url explicitly.
  ok(/^cat_[A-Za-z0-9_-]+$/.test(encodeLabelId(fancy)),
    "E: encoded label id is URL-safe base64url (no '+', '/', '=' padding)")
  // decodeLabelId strips the leading cat_ then base64url-decodes the remainder.
  ok(decodeLabelId('cat_' + Buffer.from('Home', 'utf8').toString('base64url')) === 'Home',
    "E: decodeLabelId strips 'cat_' then base64url-decodes")
}

console.log(`\ntaskid.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
