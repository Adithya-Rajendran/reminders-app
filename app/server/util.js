// Small shared server helpers (no dependencies — safe to import from anywhere).

// An Error the JSON error middleware maps to a specific HTTP status.
export const err = (msg, status) => { const e = new Error(msg); e.status = status; return e }

// CalDAV collection URLs compare/join reliably only with a trailing slash.
export const baseOf = (url) => (url.endsWith('/') ? url : url + '/')

// A WebDAV PUT "worked" on ok/201/204 (servers vary in what they return).
export const okPut = (s) => s.ok || s.status === 201 || s.status === 204

// Shape a config.js account_* row into the account object caldav.js expects.
export const accountOf = (row) => ({ id: row.account_id, type: row.account_type, server_url: row.account_server_url, username: row.account_username, password_enc: row.account_password_enc })

// Build a log-safe one-liner from a CalDAV/WebDAV error. We deliberately do NOT
// echo err.message: tsdav attaches up to ~4KB of the raw response body, which can
// carry usernames, internal hostnames, IPs, even credentials. Log only the HTTP
// status (operator-useful, never sensitive) plus a coarse, fixed-vocabulary class
// inferred from the error — enough to debug ("createEvent failed HTTP 403" /
// "fetchTasks failed (timeout)") without leaking the body.
export const sanitizeCalDAVError = (e, operation = 'request') => {
  const status = e?.status || e?.statusCode || e?.response?.status
  const sig = `${(e && e.code) || ''} ${(e && e.name) || ''} ${(e && e.message) || ''}`
  let cls = ''
  if (/abort|timeout|ETIMEDOUT/i.test(sig)) cls = 'timeout'
  else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|socket|network|TLS|certificate/i.test(sig)) cls = 'network'
  const detail = status ? `HTTP ${status}` : cls
  return `CalDAV ${operation} failed${detail ? ` (${detail})` : ''}`
}
