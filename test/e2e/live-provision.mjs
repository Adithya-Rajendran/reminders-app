// Provision the freshly-scaled-up `reminders-dev` fixture app (live-visual.yml)
// entirely through the app's own HTTP API — the in-cluster `reminders-ci`
// runner's ServiceAccount has no pods/exec RBAC (see k8s/README.md), so unlike
// test/e2e/provision.mjs (which is free to `import '../../app/server/config.js'`
// and write straight into the local SQLite file) there is no way to reach the
// dev app's storage except by asking the app itself, over the wire, the same
// way the Settings UI does.
//
// Why this exists: reminders-dev runs with CONFIG_DB_PATH=/tmp/config.db
// (ephemeral) so every scale-up boots a brand-new app with NO CalDAV account
// configured. specs/resize-polish.spec.mjs's beforeEach seeds tasks/events/
// notes through the real API — with no account, every one of those calls
// hangs or 4xxs. This script runs once, right after the fixture pods report
// Ready, and brings the app up to exactly the state provision.mjs gives the
// local e2e run: one connected CalDAV account with its lists enabled.
//
// Idempotent by design: every step either reuses what's already there or
// re-applies the same desired state, so re-running this against an
// already-provisioned instance (a retried step, a manual debug run) is a
// no-op, not a failure.
//
// ---- The notes/WebDAV account: a verified, documented gap ----
// The dev fixture mirrors test/e2e/setup-backends.sh's backend split: Radicale
// for CalDAV (VTODO/VEVENT) and wsgidav for plain WebDAV (notes). Two things
// about that split were confirmed by hand against the same Radicale/wsgidav
// versions setup-backends.sh installs (see requirements.txt):
//
//   1. app/server/webdav.js's filesBase() always derives the notes files root
//      from a *CalDAV account's* server_url + username — there is no API
//      endpoint that creates a standalone WebDAV-only account. The only way
//      to get an account row is POST /api/caldav/accounts, and that handler
//      unconditionally runs full CalDAV discovery (app/server/caldav.js
//      addAccountHandler -> discover -> clientFor, which passes
//      `defaultAccountType: 'caldav'` into tsdav's createDAVClient — tsdav
//      resolves DAV:current-user-principal before the client is even usable,
//      regardless of the account's `type`). wsgidav never implements
//      DAV:current-user-principal (confirmed: PROPFIND for it 404s inside the
//      multistatus), so an account pointed at wsgidav can never pass
//      discovery — POST /api/caldav/accounts rolls it back and 400s.
//   2. Even pointing notes at the CalDAV (Radicale) account instead — via the
//      real PUT /api/notes/config the Settings UI's notes-folder picker calls
//      — only works if Radicale's rights backend grants plain (non-calendar)
//      collections write access. Radicale's two built-in backends
//      (owner_only, owner_write — i.e. anything the fixture doesn't override
//      with a custom rights file) grant lower-case "rw" one level under a
//      user's principal: enough for MKCALENDAR (typed collections only need
//      "w"), not enough for the untyped MKCOL notes.js issues for its "Notes"
//      folder (needs upper-case "W", which neither backend grants below the
//      principal root) — confirmed locally: that MKCOL 403s.
//
// So there is currently no way to provision a *working* notes backend for
// reminders-dev through the app's real HTTP API — that would need either a
// permissive custom rights file on the fixture's Radicale, or a small
// server-side change (an endpoint that can register an account without full
// CalDAV discovery). This script still makes the real notes/config call (the
// same one the Settings UI makes) against the CalDAV account, because that IS
// the correct call and will start working the moment the fixture's rights
// allow it — it just fails loudly, with the response body, instead of letting
// the audit fail 20 minutes later inside a Playwright assertion with no
// useful context.
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '')
if (!BASE) { console.error('BASE_URL is required'); process.exit(1) }
const USER = process.env.DEV_VISUAL_USER || process.env.E2E_USER || 'visual-audit-user'
// Defaults match test/e2e/setup-backends.sh's convention (same credentials,
// same /<user>/tasks/ collection layout) — override via repo/workflow vars if
// the reminders-dev fixture's ConfigMaps ever diverge from it.
const CALDAV_URL = process.env.DEV_CALDAV_URL || 'http://radicale.reminders-dev.svc:5232/'
const CALDAV_USER = process.env.DEV_CALDAV_USER || 'e2e'
const CALDAV_PASS = process.env.DEV_CALDAV_PASS || 'e2epw'
const HEALTH_TIMEOUT_MS = Number(process.env.DEV_HEALTH_TIMEOUT_MS) || 60_000

const HDR = { 'x-dev-user': USER, 'content-type': 'application/json' }

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { ...HDR, ...(opts.headers || {}) } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { ok: res.ok, status: res.status, body, text }
}
// Fail loud: every caller that needs the request to have succeeded gets the
// full response body in the thrown error, not just a status code.
function must(label, r) {
  if (!r.ok) throw new Error(`${label} -> ${r.status}: ${r.text}`)
  return r.body
}

// Pod Ready (containerStatuses[0].ready) only means the process accepted a
// TCP connection for its probe — not that Express has finished booting
// (session store, OIDC discovery, etc). Poll /healthz for real readiness.
async function waitHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/healthz', { signal: AbortSignal.timeout(3000) })
      if (r.ok) { console.log(`healthy: ${BASE}/healthz -> ${r.status}`); return }
      lastErr = new Error(`/healthz -> ${r.status}`)
    } catch (e) { lastErr = e }
    await sleep(1500)
  }
  throw new Error(`${BASE}/healthz never became healthy within ${HEALTH_TIMEOUT_MS}ms${lastErr ? ` (last error: ${lastErr.message})` : ''}`)
}

// 'generic' normalizes to a trimmed-trailing-slash URL (caldav.js
// normalizeServerUrl) — mirror that so a re-run recognizes the same account
// it created last time instead of creating a duplicate.
const normalizeGeneric = (u) => String(u || '').trim().replace(/\/+$/, '')

// ---- 0) Bootstrap: MKCALENDAR one VTODO collection directly against
//         Radicale (basic auth), mirroring setup-backends.sh. The app cannot
//         create the FIRST calendar on an empty principal (calendarHome()
//         derives the home from existing calendars — see caldav.js; product
//         gap tracked separately), so the fixture must be seeded before the
//         account is added. Idempotent: an existing collection answers 405.
async function seedFixtureCalendar() {
  const url = normalizeGeneric(CALDAV_URL) + '/' + encodeURIComponent(CALDAV_USER) + '/tasks/'
  const body = '<?xml version="1.0" encoding="utf-8"?>'
    + '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>'
    + '<D:displayname>tasks</D:displayname>'
    + '<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>'
    + '</D:prop></D:set></C:mkcalendar>'
  const r = await fetch(url, {
    method: 'MKCALENDAR',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${CALDAV_USER}:${CALDAV_PASS}`).toString('base64'),
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body,
    signal: AbortSignal.timeout(10000),
  })
  if (r.status === 201) { console.log(`seeded fixture calendar ${url}`); return }
  if (r.status === 405 || r.status === 409) { console.log(`fixture calendar already present (${r.status}) ${url}`); return }
  throw new Error(`MKCALENDAR ${url} -> ${r.status}: ${await r.text()}`)
}

// ---- 1) CalDAV account: reuse if one already matches, else add it through
//         the real "Add account" flow (POST -> discover -> lists). ----
async function ensureCaldavAccount() {
  const { accounts = [] } = must('GET /api/caldav/accounts', await api('/api/caldav/accounts'))
  const wanted = normalizeGeneric(CALDAV_URL)
  const existing = accounts.find((a) => a.type === 'generic' && normalizeGeneric(a.serverUrl) === wanted && a.username === CALDAV_USER)
  if (existing) {
    console.log(`caldav account already provisioned: ${existing.id} (${existing.lists?.length || 0} list(s)) — refreshing discovery`)
    const { lists } = must(`POST /api/caldav/accounts/${existing.id}/discover`, await api(`/api/caldav/accounts/${existing.id}/discover`, { method: 'POST' }))
    return { id: existing.id, lists }
  }
  const add = must('POST /api/caldav/accounts', await api('/api/caldav/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: 'Radicale (dev fixture)', type: 'generic', serverUrl: CALDAV_URL, username: CALDAV_USER, password: CALDAV_PASS }),
  }))
  const account = add.account
  console.log(`caldav account created: ${account.id} with ${account.lists?.length || 0} list(s):`)
  for (const l of account.lists || []) console.log(`  - ${l.displayName || l.url} ${l.url} (vtodo=${l.supportsVtodo})`)
  return { id: account.id, lists: account.lists || [] }
}

// ---- 2) enable every discovered list (idempotent — same desired state every run). ----
async function enableAllLists(accountId, lists) {
  if (!lists.length) {
    // The auto "Reminders" VTODO calendar (caldav.js createRemindersCalendar)
    // only gets created server-side if discovery found at least one existing
    // calendar to derive the calendar-home from — see caldav.js calendarHome().
    // An empty list here means the fixture's Radicale has no pre-seeded
    // calendar (setup-backends.sh seeds one under /<user>/tasks/ for exactly
    // this reason) — nothing left for this script to enable.
    console.warn('no CalDAV lists discovered — the fixture Radicale needs at least one pre-seeded calendar (see test/e2e/setup-backends.sh\'s MKCALENDAR step) for the app\'s auto "Reminders" list to be created')
    return
  }
  must(`PUT /api/caldav/accounts/${accountId}/lists`, await api(`/api/caldav/accounts/${accountId}/lists`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: lists.map((l) => l.url) }),
  }))
  console.log(`enabled ${lists.length} list(s) on account ${accountId}`)
}

// ---- 3) notes/WebDAV config: the real Settings-UI call, against the same
//         CalDAV account (see the file header for why this is the only
//         account that can exist, and when it will actually succeed). ----
async function ensureNotesConfig(accountId) {
  const r = await api('/api/notes/config', {
    method: 'PUT',
    body: JSON.stringify({ accountId, rootPath: 'Notes' }),
  })
  if (!r.ok) {
    const msg =
      `PUT /api/notes/config -> ${r.status}: ${r.text}\n`
      + 'This is the known Radicale-rights gap described at the top of this file: '
      + 'the fixture\'s Radicale rejects the plain (non-calendar) MKCOL notes.js needs for its "Notes" folder '
      + 'unless it\'s configured with a permissive custom rights file. Fix by either loosening the '
      + 'reminders-dev Radicale ConfigMap\'s [rights] section, or by adding a server-side way to register a '
      + 'WebDAV-only account (wsgidav can never pass the CalDAV discovery POST /api/caldav/accounts requires).'
    // The resize audit doesn't need notes: the Notes widget's `unconfigured`
    // state is itself a valid audit subject. Default to a loud warning so the
    // audit still runs; set DEV_NOTES_REQUIRED=1 to restore hard failure once
    // the rights gap is closed.
    if (process.env.DEV_NOTES_REQUIRED === '1') throw new Error(msg)
    console.log(`::warning::notes provisioning skipped (non-fatal) — ${msg.split('\n')[0]}`)
    return
  }
  console.log(`notes configured: account ${accountId}, rootPath "Notes"`)
}

// ---- 4) log the task project the specs will pick, for visibility only —
//         lib.mjs's taskProjectId() re-derives this itself at runtime (no
//         state file needed here, unlike the local e2e provision.mjs). ----
async function logTaskProject() {
  const projects = must('GET /api/projects', await api('/api/projects'))
  const project = projects.find((p) => /tasks/i.test(p.title || '')) || projects[0]
  if (!project) { console.warn('no task projects visible yet (a fresh CalDAV connection can take a moment to surface one) — specs will fail taskProjectId()'); return }
  console.log(`task project the specs will use: ${project.id} ("${project.title}")`)
}

async function main() {
  console.log(`provisioning ${BASE} as ${USER}`)
  await waitHealthy()
await seedFixtureCalendar()
  const { id: accountId, lists } = await ensureCaldavAccount()
  await enableAllLists(accountId, lists)
  await logTaskProject()
  await ensureNotesConfig(accountId)
  console.log('provisioning complete')
}

main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1) })
