import express from 'express'
import session from 'express-session'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as config from './config.js'
// Tasks/projects/labels live as VTODOs in the user's CalDAV server.
import * as tasks from './tasks_caldav.js'
import { initOidc, loginUrl, handleCallback, logoutUrl, oidcConfigured } from './oidc.js'
import { sseHandler } from './events.js'
import { startValarmPoller } from './valarm-poller.js'
import * as caldav from './caldav.js'
import { rateLimitMiddleware } from './ratelimit.js'
import * as notes from './notes.js'
import * as groups from './reminder_groups.js'
import * as dailyPlan from './daily_plan.js'
import * as areas from './areas.js'
import * as mcp from './mcp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const PORT = process.env.PORT || 8080

// Fail fast rather than silently signing cookies with a public default.
const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is required')
  process.exit(1)
}
// Secure-by-default; this override is for local HTTP dev only. Surface it loudly
// so it can never silently ship to production.
if (process.env.COOKIE_INSECURE === '1') {
  console.warn('COOKIE_INSECURE=1 — session cookie Secure flag is OFF. Use only for local HTTP development, never behind HTTPS/production.')
}

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

// gzip API JSON + static assets. The SSE feed is skipped automatically: its
// handler (events.js) sets `Cache-Control: no-transform`, which compression
// honors — without that it would buffer the stream and break live reminders.
app.use(compression())

// JSON for everything EXCEPT raw resource uploads (images/drawings), which their
// own route streams as binary — JSON-parsing them would corrupt the bytes.
const jsonParser = express.json({ limit: '10mb' }) // headroom for note bodies + layouts
app.use((req, res, next) => {
  if (req.method === 'PUT' && req.path.startsWith('/api/notes/resources/')) return next()
  return jsonParser(req, res, next)
})
app.use(
  session({
    name: 'rsid',
    // SQLite-backed store so logins survive pod restarts / redeploys.
    store: config.createSessionStore(),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Behind the TLS-terminating gateway the external scheme is https.
      secure: process.env.COOKIE_INSECURE === '1' ? false : true,
      maxAge: 7 * 24 * 3600 * 1000,
    },
  }),
)

app.get('/healthz', (req, res) => res.json({ ok: true, oidc: oidcConfigured() }))

// ---- Auth (OIDC against Authentik) ----
app.get('/auth/login', async (req, res, next) => {
  try {
    if (!process.env.OIDC_ISSUER) return res.status(503).send('OIDC not configured')
    res.redirect(await loginUrl(req)) // ensureConfig() runs lazily inside loginUrl
  } catch (e) { next(e) }
})
app.get('/auth/callback', async (req, res) => {
  try {
    await handleCallback(req)
    res.redirect('/')
  } catch (e) {
    console.error('OIDC callback error:', e)
    res.status(500).send('Login failed. Please try again.')
  }
})
app.get('/auth/logout', async (req, res, next) => {
  try {
    const url = await logoutUrl(req)
    req.session.destroy(() => res.redirect(url))
  } catch (e) { next(e) }
})

// ---- Auth guard ----
function requireAuth(req, res, next) {
  if (req.session?.user) return next()
  // Opt-in dev bypass for testing via port-forward. Double-gated: disabled
  // whenever NODE_ENV=production (set in k8s), even if ALLOW_DEV_BYPASS leaks in.
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_BYPASS === '1' && req.get('x-dev-user')) {
    req.session.user = { sub: req.get('x-dev-user'), email: req.get('x-dev-user'), name: 'dev' }
    return next()
  }
  return res.status(401).json({ error: 'unauthenticated' })
}

// ---- App API ----
app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user))
app.get('/api/events', requireAuth, sseHandler)
app.get('/api/layouts/:id', requireAuth, async (req, res, next) => {
  try { res.json(await config.getLayout(req.session.user.sub, req.params.id)) } catch (e) { next(e) }
})
app.put('/api/layouts/:id', requireAuth, async (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'layout body must be a JSON object' })
  }
  try { await config.saveLayout(req.session.user.sub, req.params.id, req.body); res.json({ ok: true }) } catch (e) { next(e) }
})
// Dashboard registry (names + order for the multi-dashboard switcher).
app.get('/api/dashboards', requireAuth, async (req, res, next) => {
  try { res.json({ dashboards: await config.getDashboards(req.session.user.sub) }) } catch (e) { next(e) }
})
app.put('/api/dashboards', requireAuth, async (req, res, next) => {
  const list = req.body?.dashboards
  if (!Array.isArray(list) || list.length === 0 || list.length > 24) {
    return res.status(400).json({ error: 'dashboards must be a non-empty array (max 24)' })
  }
  const clean = []
  for (const d of list) {
    const id = String(d?.id || '')
    if (!/^[\w-]{1,64}$/.test(id) || id === config.DASH_INDEX) return res.status(400).json({ error: 'invalid dashboard id' })
    clean.push({ id, name: (String(d?.name || '').trim().slice(0, 64)) || 'Dashboard' })
  }
  try { await config.saveDashboards(req.session.user.sub, clean); res.json({ ok: true }) } catch (e) { next(e) }
})
app.delete('/api/dashboards/:id', requireAuth, async (req, res, next) => {
  if (req.params.id === config.DASH_INDEX) return res.status(400).json({ error: 'bad id' })
  try { await config.deleteDashboardLayout(req.session.user.sub, req.params.id); res.json({ ok: true }) } catch (e) { next(e) }
})
// ---- Daily plan (the few tasks picked for "today" — see server/daily_plan.js) ----
app.get('/api/daily-plan', requireAuth, async (req, res, next) => {
  try { res.json(await dailyPlan.getPlan(req.session.user.sub, req.query.date)) } catch (e) { next(e) }
})
app.put('/api/daily-plan', requireAuth, async (req, res, next) => {
  try { res.json(await dailyPlan.setPlan(req.session.user.sub, req.body?.date, req.body?.ids)) } catch (e) { next(e) }
})

// ---- Projects & Areas (the v2 organizing dimension — see server/areas.js) ----
app.get('/api/areas', requireAuth, async (req, res, next) => {
  try { res.json(await areas.list(req.session.user.sub)) } catch (e) { next(e) }
})
app.post('/api/areas', requireAuth, async (req, res, next) => {
  try { res.status(201).json(await areas.create(req.session.user.sub, req.body)) } catch (e) { next(e) }
})
app.patch('/api/areas/:id', requireAuth, async (req, res, next) => {
  try { res.json(await areas.update(req.session.user.sub, req.params.id, req.body)) } catch (e) { next(e) }
})
app.delete('/api/areas/:id', requireAuth, async (req, res, next) => {
  try { res.json(await areas.remove(req.session.user.sub, req.params.id)) } catch (e) { next(e) }
})

// ---- MCP (see server/mcp.js and docs/mcp.md) ----
// /mcp is BEARER-token auth (the only route that is): AI clients can't do the
// OIDC browser dance. Sessions stay untouched — no cookie is read or set here.
// The bucket keys on the token's resolved user, so the limiter runs post-auth.
const mcpLimit = rateLimitMiddleware(Number(process.env.MCP_RATE_LIMIT_PER_MIN) || 60, (req) => req.mcpUser?.sub)
app.post('/mcp', mcp.mcpAuth, mcpLimit, mcp.mcpHandler)
app.get('/mcp', mcp.mcpMethodNotAllowed)    // stateless transport: no GET event stream
app.delete('/mcp', mcp.mcpMethodNotAllowed) // stateless transport: no session to delete
// Management endpoints for Settings (normal session auth).
app.get('/api/mcp/settings', requireAuth, mcp.getSettingsHandler)
app.put('/api/mcp/settings', requireAuth, mcp.putSettingsHandler)
app.post('/api/mcp/token', requireAuth, mcp.createTokenHandler)
app.delete('/api/mcp/token', requireAuth, mcp.deleteTokenHandler)
// CalDAV settings + tasks
app.get('/api/caldav/accounts', requireAuth, caldav.listAccountsHandler)
// The two outbound-probing routes (add + discover make CalDAV PROPFINDs) share a
// per-user rate limit so an authenticated user can't spam them / scan hosts.
const caldavProbeLimit = rateLimitMiddleware(Number(process.env.CALDAV_RATE_LIMIT_PER_MIN) || 10)
app.post('/api/caldav/accounts', requireAuth, caldavProbeLimit, caldav.addAccountHandler)
app.post('/api/caldav/accounts/:id/discover', requireAuth, caldavProbeLimit, caldav.discoverHandler)
app.put('/api/caldav/accounts/:id/lists', requireAuth, caldav.setListsHandler)
app.delete('/api/caldav/accounts/:id', requireAuth, caldav.deleteAccountHandler)
app.get('/api/caldav/tasks', requireAuth, caldav.fetchTasksHandler)

// CalDAV calendar events (VEVENT CRUD)
app.get('/api/calendar/events', requireAuth, caldav.calendarEventsHandler)
app.post('/api/calendar/events', requireAuth, caldav.createEventHandler)
app.patch('/api/calendar/events', requireAuth, caldav.updateEventHandler)
app.delete('/api/calendar/events', requireAuth, caldav.deleteEventHandler)

// Tasks / projects / labels — CalDAV-backed store.
app.get('/api/projects', requireAuth, tasks.listProjects)
app.get('/api/projects/:id/tasks', requireAuth, tasks.listProjectTasks)
app.put('/api/projects/:id/tasks', requireAuth, tasks.createTask)
app.get('/api/tasks', requireAuth, tasks.listTasks)
app.post('/api/tasks/:id', requireAuth, tasks.patchTask)
app.delete('/api/tasks/:id', requireAuth, tasks.deleteTask)
app.get('/api/labels', requireAuth, tasks.listLabels)
app.put('/api/labels', requireAuth, tasks.createLabel)
app.put('/api/tasks/:id/labels', requireAuth, tasks.attachLabel)

// ---- Reminder groups <-> calendars ----
app.get('/api/reminder-groups', requireAuth, async (req, res, next) => {
  try { res.json(await groups.listGroups(req.session.user.sub)) } catch (e) { next(e) }
})
app.put('/api/reminder-groups', requireAuth, async (req, res, next) => {
  const { group, listId, createNew } = req.body || {}
  if (!group) return res.status(400).json({ error: 'group is required' })
  try { res.json(await groups.mapGroup(req.session.user.sub, group, { listId, createNew })) } catch (e) { next(e) }
})
app.delete('/api/reminder-groups', requireAuth, async (req, res, next) => {
  const group = req.query.group || req.body?.group
  const del = req.query.deleteCalendar === '1' || req.body?.deleteCalendar === true
  if (!group) return res.status(400).json({ error: 'group is required' })
  try { res.json(await groups.deleteGroup(req.session.user.sub, group, del)) } catch (e) { next(e) }
})

// ---- Notes (Markdown files in the user's Nextcloud, over WebDAV) ----
app.get('/api/notes', requireAuth, async (req, res, next) => {
  try { const list = await notes.listNotes(req.session.user.sub); res.json({ configured: list !== null, notes: list || [] }) } catch (e) { next(e) }
})
app.get('/api/notes/search', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30))
    res.json({ results: notes.searchNotes(req.session.user.sub, String(req.query.q || ''), limit) })
  } catch (e) { next(e) }
})
app.get('/api/notes/backlinks', requireAuth, async (req, res, next) => {
  try { res.json({ backlinks: notes.backlinksFor(req.session.user.sub, req.query.path || '') }) } catch (e) { next(e) }
})
app.get('/api/notes/config', requireAuth, async (req, res, next) => {
  try { res.json(await notes.getConfig(req.session.user.sub)) } catch (e) { next(e) }
})
app.put('/api/notes/config', requireAuth, async (req, res, next) => {
  try { res.json(await notes.setConfig(req.session.user.sub, req.body?.accountId, req.body?.rootPath)) } catch (e) { next(e) }
})
app.get('/api/notes/browse', requireAuth, async (req, res, next) => {
  try { res.json((await notes.browse(req.session.user.sub, req.query.path || '')) || { path: '', folders: [] }) } catch (e) { next(e) }
})
app.get('/api/notes/folders', requireAuth, async (req, res, next) => {
  try { res.json({ folders: (await notes.listFolders(req.session.user.sub)) || [] }) } catch (e) { next(e) }
})
app.post('/api/notes/folders', requireAuth, async (req, res, next) => {
  try { res.json(await notes.createFolder(req.session.user.sub, req.body?.folder)) } catch (e) { next(e) }
})
app.post('/api/notes', requireAuth, async (req, res, next) => {
  try { res.status(201).json(await notes.createNote(req.session.user.sub, req.body || {})) } catch (e) { next(e) }
})
app.get('/api/notes/item', requireAuth, async (req, res, next) => {
  try { const n = await notes.getNote(req.session.user.sub, req.query.path); if (!n) return res.status(404).json({ error: 'not found' }); res.json(n) } catch (e) { next(e) }
})
app.put('/api/notes/item', requireAuth, async (req, res, next) => {
  const { path, body, etag, tags } = req.body || {}
  if (!path) return res.status(400).json({ error: 'path required' })
  try { res.json(await notes.saveNote(req.session.user.sub, path, { body, etag, tags })) } catch (e) { next(e) }
})
app.post('/api/notes/rename', requireAuth, async (req, res, next) => {
  const { path, title } = req.body || {}
  if (!path || !title) return res.status(400).json({ error: 'path and title required' })
  try { res.json(await notes.renameNote(req.session.user.sub, path, title)) } catch (e) { next(e) }
})
app.post('/api/notes/pin', requireAuth, async (req, res, next) => {
  try { res.json(await notes.setPinned(req.session.user.sub, req.body?.path, !!req.body?.pinned)) } catch (e) { next(e) }
})
app.post('/api/notes/duplicate', requireAuth, async (req, res, next) => {
  try { res.status(201).json(await notes.duplicateNote(req.session.user.sub, req.body?.path)) } catch (e) { next(e) }
})
app.post('/api/notes/move', requireAuth, async (req, res, next) => {
  const { path, folder } = req.body || {}
  if (!path) return res.status(400).json({ error: 'path required' })
  try { res.json(await notes.moveNote(req.session.user.sub, path, folder || '')) } catch (e) { next(e) }
})
app.post('/api/notes/move-folder', requireAuth, async (req, res, next) => {
  const { from, to } = req.body || {}
  if (!from) return res.status(400).json({ error: 'from required' })
  try { res.json(await notes.moveFolder(req.session.user.sub, from, to || '')) } catch (e) { next(e) }
})
app.delete('/api/notes/item', requireAuth, async (req, res, next) => {
  const path = req.query.path || req.body?.path
  if (!path) return res.status(400).json({ error: 'path required' })
  try { res.json(await notes.deleteNote(req.session.user.sub, path)) } catch (e) { next(e) }
})
app.get('/api/notes/trash', requireAuth, async (req, res, next) => {
  try { res.json({ notes: (await notes.listTrash(req.session.user.sub)) || [] }) } catch (e) { next(e) }
})
app.post('/api/notes/trash', requireAuth, async (req, res, next) => {
  try { res.json(await notes.trashNote(req.session.user.sub, req.body?.path)) } catch (e) { next(e) }
})
app.post('/api/notes/restore', requireAuth, async (req, res, next) => {
  try { res.json(await notes.restoreNote(req.session.user.sub, req.body?.path)) } catch (e) { next(e) }
})
app.post('/api/notes/trash/empty', requireAuth, async (req, res, next) => {
  try { res.json(await notes.emptyTrash(req.session.user.sub)) } catch (e) { next(e) }
})
app.get('/api/notes/resources/:name', requireAuth, async (req, res, next) => {
  try {
    const f = await notes.getResource(req.session.user.sub, req.params.name)
    if (!f) return res.status(404).json({ error: 'not found' })
    res.set('Content-Type', f.contentType || 'application/octet-stream')
    res.set('Cache-Control', 'private, max-age=86400')
    res.send(f.buffer)
  } catch (e) { next(e) }
})
app.put('/api/notes/resources/:name', requireAuth, express.raw({ type: '*/*', limit: '25mb' }), async (req, res, next) => {
  try { res.json(await notes.putResource(req.session.user.sub, req.params.name, req.body, req.get('content-type'))) } catch (e) { next(e) }
})

// Any other /api/* is a real 404 (JSON, so the SPA doesn't get an HTML page).
// (`{*splat}` is Express 5 syntax for the old `*`: zero or more segments.)
app.all('/api/{*splat}', (_q, r) => r.status(404).json({ error: 'not found' }))

// ---- Static SPA + client-side routing fallback ----
// Vite content-hashes everything under /assets, so those files are immutable and
// safe to cache for a year; index.html (served only via the fallback below) must
// stay revalidated since it references the current hashed filenames. `index:false`
// routes "/" through the fallback so the HTML never gets the immutable header.
app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
  res.set('Cache-Control', 'no-cache')
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Honor an explicit status (e.g. body-parser sets 400 on malformed JSON) so
  // client mistakes surface as 4xx instead of a misleading 500.
  const status = err.status || err.statusCode || 500
  if (status >= 500) console.error('unhandled error:', err)
  res.status(status).json({ error: status >= 500 ? 'internal error' : (err.message || 'bad request') })
})

const start = async () => {
  await config.initConfigSchema()
  await initOidc()
  startValarmPoller() // polls CalDAV VALARMs -> per-user SSE reminders
  app.listen(PORT, () => console.log('reminders-app BFF listening on :' + PORT))
}
start().catch((e) => { console.error('fatal startup error:', e); process.exit(1) })
