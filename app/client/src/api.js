// Thin fetch wrapper. On 401 we bounce to the BFF login route, which starts
// the OIDC flow against Authentik.
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  if (res.status === 401) {
    window.location.href = '/auth/login'
    throw new Error('unauthenticated')
  }
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  const ct = res.headers.get('content-type') || ''
  return ct.includes('json') ? res.json() : res.text()
}

// Task / project / label API (CalDAV-backed), served by the BFF.
export const tk = (path, opts) => api('/api' + path, opts)
