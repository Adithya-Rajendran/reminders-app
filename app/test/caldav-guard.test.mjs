// Characterization test for the CalDAV SSRF egress guard in server/caldav.js:
// ipBlocked() IP classification (loopback/link-local/multicast/IPv6-special are
// blocked; RFC1918/ULA/CGNAT are ALLOWED by default), normalizeServerUrl() URL
// canonicalization, and safeFetch()'s pre-fetch rejection of blocked/non-http(s)/
// unresolvable destinations (no network is hit on the reject paths). Run with:
//   docker run --rm -v "$PWD":/app -w /app -e CONFIG_STORE=sqlite \
//     -e CONFIG_DB_PATH=/tmp/caldav-guard.test.db node:22 node test/caldav-guard.test.mjs
import { rmSync } from 'node:fs'

// Importing caldav.js transitively imports config.js, which opens SQLite at import
// time, so point it at a throwaway file (the guard under test never touches it).
process.env.CONFIG_STORE = process.env.CONFIG_STORE || 'sqlite'
process.env.CONFIG_DB_PATH = process.env.CONFIG_DB_PATH || '/tmp/caldav-guard.test.db'
rmSync(process.env.CONFIG_DB_PATH, { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-wal', { force: true })
rmSync(process.env.CONFIG_DB_PATH + '-shm', { force: true })

const { ipBlocked, normalizeServerUrl, safeFetch } = await import('../server/caldav.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m) } }

// Capture a thrown/rejected error, or null if the call resolved.
const caught = async (fn) => { try { await fn(); return null } catch (e) { return e } }

// ---- ipBlocked: BLOCKED (true) ----
ok(ipBlocked('0.0.0.0') === true, 'unspecified 0.0.0.0 is blocked')
ok(ipBlocked('127.0.0.1') === true && ipBlocked('127.1.2.3') === true, 'IPv4 loopback /8 is blocked')
ok(ipBlocked('169.254.169.254') === true, 'cloud metadata 169.254.169.254 is blocked')
ok(ipBlocked('169.254.0.1') === true, 'IPv4 link-local 169.254/16 is blocked')
ok(ipBlocked('224.0.0.1') === true && ipBlocked('239.1.1.1') === true && ipBlocked('255.255.255.255') === true,
  'IPv4 multicast/broadcast (first octet >= 224) is blocked')
ok(ipBlocked('::1') === true && ipBlocked('::') === true, 'IPv6 loopback ::1 and unspecified :: are blocked')
ok(ipBlocked('fe80::1') === true, 'IPv6 link-local fe80::/10 is blocked')
ok(ipBlocked('ff02::1') === true, 'IPv6 multicast ff00::/8 is blocked')
ok(ipBlocked('::ffff:127.0.0.1') === true, 'IPv4-mapped IPv6 loopback ::ffff:127.0.0.1 is blocked')

// ---- ipBlocked: ALLOWED (false) by default (CALDAV_BLOCK_PRIVATE unset) ----
ok(['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.10'].every((ip) => ipBlocked(ip) === false),
  'RFC1918 private ranges are allowed by default')
ok(ipBlocked('100.64.0.1') === false, 'CGNAT 100.64/10 is allowed by default')
ok(ipBlocked('fd00::1') === false && ipBlocked('fc00::1') === false, 'IPv6 ULA fc00::/7 is allowed by default')
ok(['8.8.8.8', '1.1.1.1', '93.184.216.34'].every((ip) => ipBlocked(ip) === false), 'public IPv4 addresses are allowed')

// ---- ipBlocked: edge cases just OUTSIDE a private block (all allowed) ----
ok(['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1'].every((ip) => ipBlocked(ip) === false),
  'addresses bordering 172.16/12 and 100.64/10 are allowed (not inside the private block)')

// ---- ipBlocked: pin the LOWER edges of the blocked ranges (these are non-vacuous
// even under default env, since they exercise the `return false` public path) ----
// Just below the multicast cutoff: o[0] >= 224 must NOT swallow 223.x.
ok(ipBlocked('223.255.255.255') === false, '223.x (just below multicast 224) is allowed')
// Only the high block is >= 224: ordinary high-but-public addresses stay allowed
// (would catch a mutation broadening the block to e.g. >= 127/128).
ok(ipBlocked('200.1.2.3') === false && ipBlocked('128.0.0.1') === false,
  'public addresses in 128..223 are allowed (only >= 224 is blocked)')
// Link-local block is specifically 169.254/16, not all of 169.x.
ok(ipBlocked('169.253.0.1') === false && ipBlocked('169.255.0.1') === false,
  '169.253/169.255 (outside link-local 169.254/16) are allowed')

// ---- ipBlocked under CALDAV_BLOCK_PRIVATE=1 ----
// BLOCK_PRIVATE is read once at module load, so re-import a fresh copy with the env
// flag set (a query string busts the ESM cache; the static `./config.js` import has
// no query string, so it stays the one cached SQLite handle — not re-opened). Under
// the default-env section above, every private/edge IPv4 returns false via
// `priv ? BLOCK_PRIVATE : false` whether or not `priv` is computed correctly; only
// here does the private-range CLASSIFICATION (and the v4-mapped extraction feeding
// it) actually get pinned.
process.env.CALDAV_BLOCK_PRIVATE = '1'
const { ipBlocked: ipBlockedStrict } = await import('../server/caldav.js?blockprivate=1')
ok(['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.10'].every((ip) => ipBlockedStrict(ip) === true),
  'RFC1918 private ranges are BLOCKED when CALDAV_BLOCK_PRIVATE=1')
ok(ipBlockedStrict('100.64.0.1') === true && ipBlockedStrict('100.127.255.255') === true,
  'CGNAT 100.64/10 is BLOCKED when CALDAV_BLOCK_PRIVATE=1')
ok(ipBlockedStrict('fc00::1') === true && ipBlockedStrict('fd00::1') === true,
  'IPv6 ULA fc00::/7 is BLOCKED when CALDAV_BLOCK_PRIVATE=1')
ok(ipBlockedStrict('::ffff:10.0.0.1') === true,
  'v4-mapped private (::ffff:10.0.0.1) is BLOCKED under strict — locks the v4-mapped extraction into the private path')
// The just-outside edges must STAY allowed even under strict (this is the half the
// default-env edge test could never actually prove).
ok(['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1'].every((ip) => ipBlockedStrict(ip) === false),
  'addresses bordering 172.16/12 and 100.64/10 stay allowed even under CALDAV_BLOCK_PRIVATE=1')
ok(ipBlockedStrict('8.8.8.8') === false && ipBlockedStrict('93.184.216.34') === false,
  'public addresses stay allowed under CALDAV_BLOCK_PRIVATE=1')
ok(ipBlockedStrict('127.0.0.1') === true && ipBlockedStrict('169.254.169.254') === true && ipBlockedStrict('::1') === true,
  'always-blocked addresses remain blocked under CALDAV_BLOCK_PRIVATE=1')
// The original default-env classifier must be unaffected by the second import.
ok(ipBlocked('10.0.0.5') === false && ipBlocked('172.16.0.1') === false,
  'the default-env ipBlocked still allows private ranges after the strict re-import')

// ---- normalizeServerUrl ----
ok(normalizeServerUrl('icloud', undefined) === 'https://caldav.icloud.com'
  && normalizeServerUrl('icloud', 'https://ignored.example') === 'https://caldav.icloud.com',
  'icloud type returns the fixed caldav.icloud.com, ignoring serverUrl')
ok(normalizeServerUrl('nextcloud', 'https://nc.example.com') === 'https://nc.example.com/remote.php/dav',
  'nextcloud appends /remote.php/dav')
ok(normalizeServerUrl('nextcloud', 'https://nc.example.com/remote.php/dav') === 'https://nc.example.com/remote.php/dav',
  'nextcloud leaves an existing /remote.php/dav unchanged')
ok(normalizeServerUrl('nextcloud', 'https://nc.example.com/') === 'https://nc.example.com/remote.php/dav',
  'nextcloud strips a trailing slash before appending /remote.php/dav')
ok(normalizeServerUrl('radicale', 'https://dav.example.com/') === 'https://dav.example.com',
  'generic type trims trailing slash and appends no dav suffix')

// ---- safeFetch: the guard rejects BEFORE any fetch (no network on these paths) ----
const eLoop = await caught(() => safeFetch('http://127.0.0.1/x'))
ok(eLoop !== null && eLoop.status === 400, 'safeFetch rejects a loopback destination (status 400) before fetching')
const eMeta = await caught(() => safeFetch('http://169.254.169.254/latest/meta-data'))
ok(eMeta !== null && eMeta.status === 400, 'safeFetch rejects the cloud metadata IP')
const eV6 = await caught(() => safeFetch('http://[::1]:8080/'))
ok(eV6 !== null && eV6.status === 400, 'safeFetch rejects a bracketed IPv6 loopback host (status 400)')
const eFile = await caught(() => safeFetch('file:///etc/passwd'))
ok(eFile !== null && eFile.status === 400, 'safeFetch rejects file:// as a non-http(s) protocol with status 400')
const eFtp = await caught(() => safeFetch('ftp://host/x'))
ok(eFtp !== null && eFtp.status === 400, 'safeFetch rejects ftp:// as a non-http(s) protocol with status 400')
const eDns = await caught(() => safeFetch('http://nonexistent.invalid.host.example/'))
ok(eDns !== null && eDns.status === 400, 'safeFetch rejects a host that does not resolve (status 400)')

console.log(`\ncaldav-guard.test: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
