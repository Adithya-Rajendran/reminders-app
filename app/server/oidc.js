import * as oidc from 'openid-client'

let config = null

export function oidcConfigured() {
  return !!config
}

async function discover() {
  config = await oidc.discovery(
    new URL(process.env.OIDC_ISSUER),
    process.env.OIDC_CLIENT_ID,
    process.env.OIDC_CLIENT_SECRET,
  )
  console.log('OIDC discovered issuer:', config.serverMetadata().issuer)
}

export async function initOidc() {
  if (!process.env.OIDC_ISSUER || !process.env.OIDC_CLIENT_ID) {
    console.warn('OIDC not configured (missing OIDC_ISSUER/OIDC_CLIENT_ID) — /auth/login disabled')
    return
  }
  // Non-fatal: if discovery fails at startup (e.g. transient DNS), retry lazily
  // on the first login attempt so the pod doesn't crash-loop.
  try { await discover() } catch (e) {
    console.error('OIDC discovery failed at startup, will retry on first login:', e?.message || e)
  }
}

async function ensureConfig() {
  if (!config) await discover()
  return config
}

export async function loginUrl(req) {
  await ensureConfig()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  req.session.oidc = { codeVerifier, state, nonce }
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: process.env.OIDC_REDIRECT_URI,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  return url.href
}

export async function handleCallback(req) {
  await ensureConfig()
  const { codeVerifier, state, nonce } = req.session.oidc || {}
  if (!codeVerifier) throw new Error('no login in progress')
  const current = new URL(process.env.OIDC_REDIRECT_URI)
  for (const [k, v] of Object.entries(req.query)) current.searchParams.set(k, v)
  const tokens = await oidc.authorizationCodeGrant(config, current, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
  })
  const claims = tokens.claims()
  const user = {
    sub: claims.sub,
    email: claims.email,
    name: claims.name || claims.preferred_username || claims.email || claims.sub,
  }
  const idToken = tokens.id_token
  // Issue a fresh session id on privilege elevation (anti session-fixation).
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  )
  req.session.user = user
  req.session.id_token = idToken
}

export async function logoutUrl(req) {
  const meta = config?.serverMetadata?.()
  if (meta?.end_session_endpoint) {
    const u = new URL(meta.end_session_endpoint)
    if (req.session?.id_token) u.searchParams.set('id_token_hint', req.session.id_token)
    u.searchParams.set('post_logout_redirect_uri', process.env.APP_BASE_URL || '/')
    return u.href
  }
  return '/'
}
