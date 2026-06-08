import express from 'express'
import session from 'express-session'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as config from './config.js'
// Tasks/projects/labels live as VTODOs in the user's CalDAV server.
import * as tasks from './tasks_caldav.js'
import { initOidc, loginUrl, handleCallback, logoutUrl, oidcConfigured } from './oidc.js'
import { sseHandler } from './events.js'
import { startValarmPoller } from './valarm-poller.js'
import * as caldav from './caldav.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const PORT = process.env.PORT || 8080

// Fail fast rather than silently signing cookies with a public default.
const SESSION_SECRET = process.env.SESSION_SECRET
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET is required')
  process.exit(1)
}

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(express.json({ limit: '2mb' }))
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
// CalDAV settings + tasks
app.get('/api/caldav/accounts', requireAuth, caldav.listAccountsHandler)
app.post('/api/caldav/accounts', requireAuth, caldav.addAccountHandler)
app.post('/api/caldav/accounts/:id/discover', requireAuth, caldav.discoverHandler)
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
// Any other /api/* is a real 404 (JSON, so the SPA doesn't get an HTML page).
app.all('/api/*', (_q, r) => r.status(404).json({ error: 'not found' }))

// ---- Static SPA + client-side routing fallback ----
app.use(express.static(PUBLIC_DIR))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next()
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
