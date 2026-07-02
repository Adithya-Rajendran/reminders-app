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
  if (!res.ok) {
    const e = new Error((await res.text()) || res.statusText)
    // Attach the HTTP status so callers can distinguish 409 (conflict) from
    // 5xx network errors without parsing the message string.
    e.status = res.status
    throw e
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('json') ? res.json() : res.text()
}

// Task / project / label API (CalDAV-backed), served by the BFF.
export const tk = (path, opts) => api('/api' + path, opts)

// Reminder groups ↔ calendars: { groups:[{name,count,listId,calendar}], calendars:[{id,name}] }.
export const reminderGroups = () => api('/api/reminder-groups')

// Notes (Markdown files in the user's Nextcloud, via WebDAV) + binary resources.
const qp = (p) => '?path=' + encodeURIComponent(p)
export const notesApi = {
  list: () => tk('/notes'),
  search: (q, limit = 30) => tk('/notes/search?q=' + encodeURIComponent(q) + '&limit=' + limit),
  backlinks: (path) => tk('/notes/backlinks' + qp(path)),
  config: () => tk('/notes/config'),
  setConfig: (accountId, rootPath) => tk('/notes/config', { method: 'PUT', body: JSON.stringify({ accountId, rootPath }) }),
  browse: (path = '') => tk('/notes/browse' + qp(path)),
  create: (folder, title) => tk('/notes', { method: 'POST', body: JSON.stringify({ folder, title }) }),
  get: (path) => tk('/notes/item' + qp(path)),
  save: (path, body, etag, tags) => tk('/notes/item', { method: 'PUT', body: JSON.stringify({ path, body, etag, tags }) }),
  rename: (path, title) => tk('/notes/rename', { method: 'POST', body: JSON.stringify({ path, title }) }),
  setPinned: (path, pinned) => tk('/notes/pin', { method: 'POST', body: JSON.stringify({ path, pinned }) }),
  duplicate: (path) => tk('/notes/duplicate', { method: 'POST', body: JSON.stringify({ path }) }),
  move: (path, folder) => tk('/notes/move', { method: 'POST', body: JSON.stringify({ path, folder }) }),
  moveFolder: (from, to) => tk('/notes/move-folder', { method: 'POST', body: JSON.stringify({ from, to }) }),
  folders: () => tk('/notes/folders'),
  createFolder: (folder) => tk('/notes/folders', { method: 'POST', body: JSON.stringify({ folder }) }),
  del: (path) => tk('/notes/item' + qp(path), { method: 'DELETE' }),
  trash: (path) => tk('/notes/trash', { method: 'POST', body: JSON.stringify({ path }) }),
  trashList: () => tk('/notes/trash'),
  restore: (path) => tk('/notes/restore', { method: 'POST', body: JSON.stringify({ path }) }),
  emptyTrash: () => tk('/notes/trash/empty', { method: 'POST' }),
  uploadResource: async (name, blob, contentType) => {
    const res = await fetch('/api/notes/resources/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'content-type': contentType || blob.type || 'application/octet-stream' }, body: blob,
    })
    if (res.status === 401) { window.location.href = '/auth/login'; throw new Error('unauthenticated') }
    if (!res.ok) throw new Error((await res.text()) || 'upload failed')
    return res.json()
  },
}
