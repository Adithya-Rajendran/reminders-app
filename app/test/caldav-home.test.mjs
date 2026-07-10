// Characterization test for the CalDAV empty-principal bootstrap fix
// (caldav.js resolveHome() + config.js's caldav_accounts.home_url column):
// connecting a fresh Radicale/Baïkal server with ZERO existing calendars must
// still let the app locate a calendar-home URL to create its auto "Reminders"
// list (and later, group calendars) into. Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite \
//     -e CONFIG_DB_PATH=/tmp/caldav-home.test.db node:22 node test/caldav-home.test.mjs
import { rmSync } from 'node:fs'

process.env.CONFIG_STORE = process.env.CONFIG_STORE || 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/caldav-home.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const { resolveHome, extractPropHref } = await import('../server/caldav.js')
const cfg = await import('../server/config.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// ---- resolveHome: pure fallback logic ----
ok(resolveHome([{ url: 'https://dav.example.com/alice/cal-1/' }], 'https://fresh/', 'https://stored/')
  === 'https://dav.example.com/alice/',
  'a discovered calendar wins even when fresher/stored homes are also available (unchanged existing behavior)')
ok(resolveHome([], 'https://dav.example.com/alice/', 'https://stale-stored/') === 'https://dav.example.com/alice/',
  'an empty principal (zero calendars) falls back to the freshly-discovered login-time home')
ok(resolveHome([], null, 'https://stored-only/') === 'https://stored-only/',
  'with no fresh discovery available (createGroupCalendar\'s case), falls back to the stored home_url')
ok(resolveHome([], null, null) === null, 'no calendars, no fresh home, no stored home -> null (caller surfaces the 502)')
ok(resolveHome([{ url: null }, { url: undefined }], 'https://fresh-only/', null) === 'https://fresh-only/',
  'calendars with no usable url are skipped, falling through to freshHome')
ok(resolveHome([], undefined, undefined) === null, 'undefined inputs (not just null) still resolve to null, never "undefined"')

// ---- extractPropHref: the multistatus parsing probeHomeUrl() relies on ----
// Radicale 3.x emits UNPREFIXED DAV: elements (captured from a live 3.7.5).
const radicale = '<?xml version=\'1.0\' encoding=\'utf-8\'?>'
  + '<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><response><href>/freshuser/</href>'
  + '<propstat><prop><current-user-principal><href>/freshuser/</href></current-user-principal>'
  + '<C:calendar-home-set><href>/freshuser/</href></C:calendar-home-set></prop>'
  + '<status>HTTP/1.1 200 OK</status></propstat></response></multistatus>'
ok(extractPropHref(radicale, 'current-user-principal') === '/freshuser/',
  'finds an unprefixed current-user-principal href (Radicale style)')
ok(extractPropHref(radicale, 'calendar-home-set') === '/freshuser/',
  'finds a prefixed calendar-home-set href (C: prefix)')
// Nextcloud/sabre emits d:/cal:-prefixed elements.
const sabre = '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response>'
  + '<d:href>/remote.php/dav/</d:href><d:propstat><d:prop>'
  + '<d:current-user-principal><d:href>/remote.php/dav/principals/users/alice/</d:href></d:current-user-principal>'
  + '<cal:calendar-home-set><d:href>/remote.php/dav/calendars/alice/</d:href></cal:calendar-home-set>'
  + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
ok(extractPropHref(sabre, 'current-user-principal') === '/remote.php/dav/principals/users/alice/',
  'finds a d:-prefixed current-user-principal href (Nextcloud/sabre style)')
ok(extractPropHref(sabre, 'calendar-home-set') === '/remote.php/dav/calendars/alice/',
  'finds a cal:-prefixed calendar-home-set href')
ok(extractPropHref('<multistatus/>', 'calendar-home-set') === null, 'no match -> null (never a bogus value)')
ok(extractPropHref(null, 'calendar-home-set') === null, 'null body (failed PROPFIND) -> null, never throws')
// An empty/self-closing prop (404 propstat) must not match.
ok(extractPropHref('<prop><current-user-principal/></prop>', 'current-user-principal') === null,
  'a self-closing (absent) prop yields null')

// ---- config.js: caldav_accounts.home_url column + setAccountHomeUrl ----
const U = 'sub-home-test'
await cfg.insertAccount({ id: 'ca-home-1', user_id: U, name: 'Fresh Radicale', type: 'generic', server_url: 'https://dav/', username: 'e2e', password_enc: 'ENC' })
const fresh = await cfg.getAccount(U, 'ca-home-1')
ok(fresh.home_url == null, 'a newly-inserted account has no home_url yet (column defaults to NULL)')

await cfg.setAccountHomeUrl('ca-home-1', 'https://dav/e2e/')
const withHome = await cfg.getAccount(U, 'ca-home-1')
ok(withHome.home_url === 'https://dav/e2e/', 'setAccountHomeUrl persists the discovered home and getAccount returns it')

// Re-discovery on a migrated principal must overwrite, not merge/append.
await cfg.setAccountHomeUrl('ca-home-1', 'https://dav2/e2e/')
ok((await cfg.getAccount(U, 'ca-home-1')).home_url === 'https://dav2/e2e/', 'setAccountHomeUrl overwrites on a later discover (principal migration)')

// listAccounts (used by fetchTasks/fetchEvents fan-out) must also carry it —
// it's a plain SELECT * column, not something that needs separate wiring.
const listed = (await cfg.listAccounts(U)).find((a) => a.id === 'ca-home-1')
ok(listed?.home_url === 'https://dav2/e2e/', 'listAccounts rows also carry home_url (SELECT * picks it up automatically)')

console.log(`\ncaldav-home.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
