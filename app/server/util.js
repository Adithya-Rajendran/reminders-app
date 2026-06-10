// Small shared server helpers (no dependencies — safe to import from anywhere).

// An Error the JSON error middleware maps to a specific HTTP status.
export const err = (msg, status) => { const e = new Error(msg); e.status = status; return e }

// CalDAV collection URLs compare/join reliably only with a trailing slash.
export const baseOf = (url) => (url.endsWith('/') ? url : url + '/')

// A WebDAV PUT "worked" on ok/201/204 (servers vary in what they return).
export const okPut = (s) => s.ok || s.status === 201 || s.status === 204

// Shape a config.js account_* row into the account object caldav.js expects.
export const accountOf = (row) => ({ id: row.account_id, type: row.account_type, server_url: row.account_server_url, username: row.account_username, password_enc: row.account_password_enc })
