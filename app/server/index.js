import express from 'express'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDb, getLayout, saveLayout, pool } from './db.js'
import { proxyVikunja } from './vikunja.js'
import { initOidc, loginUrl, handleCallback, logoutUrl, oidcConfigured } from './oidc.js'
import { sseHandler, handleWebhook } from './events.js'
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

// The Vikunja webhook receiver needs the RAW body to verify the HMAC
// signature, so it is registered BEFORE the JSON body parser, on its own path.
app.post('/api/webhooks/vikunja', express.raw({ type: '*/*', limit: '1mb' }), handleWebhook)

app.use(express.json({ limit: '2mb' }))
const PgStore = connectPgSimple(session)
app.use(
  session({
    name: 'rsid',
    // Postgres-backed store so logins survive pod restarts / kubectl-cp redeploys.
    store: new PgStore({ pool, createTableIfMissing: true }),
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
  try { res.json(await getLayout(req.session.user.sub, req.params.id)) } catch (e) { next(e) }
})
app.put('/api/layouts/:id', requireAuth, async (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'layout body must be a JSON object' })
  }
  try { await saveLayout(req.session.user.sub, req.params.id, req.body); res.json({ ok: true }) } catch (e) { next(e) }
})
// CalDAV settings + tasks
app.get('/api/caldav/accounts', requireAuth, caldav.listAccountsHandler)
app.post('/api/caldav/accounts', requireAuth, caldav.addAccountHandler)
app.post('/api/caldav/accounts/:id/discover', requireAuth, caldav.discoverHandler)
app.put('/api/caldav/accounts/:id/lists', requireAuth, caldav.setListsHandler)
app.delete('/api/caldav/accounts/:id', requireAuth, caldav.deleteAccountHandler)
app.get('/api/caldav/tasks', requireAuth, caldav.fetchTasksHandler)
app.post('/api/caldav/tasks/toggle', requireAuth, caldav.toggleHandler)

// CalDAV calendar events (VEVENT CRUD)
app.get('/api/calendar/events', requireAuth, caldav.calendarEventsHandler)
app.post('/api/calendar/events', requireAuth, caldav.createEventHandler)
app.patch('/api/calendar/events', requireAuth, caldav.updateEventHandler)
app.delete('/api/calendar/events', requireAuth, caldav.deleteEventHandler)

app.all('/api/vikunja/*', requireAuth, proxyVikunja)

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
  await initDb()
  await caldav.initCaldavDb()
  await initOidc()
  app.listen(PORT, () => console.log('reminders-app BFF listening on :' + PORT))
}
start().catch((e) => { console.error('fatal startup error:', e); process.exit(1) })
