// Provision a freshly-started BFF for the e2e run:
//   1. add the Radicale CalDAV account through the REAL API (exercises discovery
//      + the auto "Reminders" calendar creation),
//   2. enable all discovered lists,
//   3. insert the notes WebDAV account directly into the config DB (a pure-WebDAV
//      server can't pass CalDAV discovery, so it can't go through the API) and
//      point notes at it,
//   4. write .state/e2e.json describing what the specs need (ids, list URLs).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STATE = path.join(HERE, '.state')
const IP = fs.readFileSync(path.join(STATE, 'ip'), 'utf8').trim()
const BASE = `http://${IP}:8080`
const USER = 'e2e-user'
const HDR = { 'x-dev-user': USER, 'content-type': 'application/json' }

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { ...HDR, ...(opts.headers || {}) } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${p} -> ${res.status}: ${text}`)
  return body
}

// 1) CalDAV account via the real API (type 'generic' => serverUrl used verbatim).
const add = await api('/api/caldav/accounts', {
  method: 'POST',
  body: JSON.stringify({ name: 'Radicale', type: 'generic', serverUrl: `http://${IP}:5232/`, username: 'e2e', password: 'e2epw' }),
})
const accountId = add.account.id
const lists = add.account.lists || []
console.log(`caldav account ${accountId} with ${lists.length} list(s):`)
for (const l of lists) console.log(`  - ${l.displayName || l.url} ${l.url} (vtodo=${l.supportsVtodo})`)

// 2) enable every discovered list.
await api(`/api/caldav/accounts/${accountId}/lists`, { method: 'PUT', body: JSON.stringify({ enabled: lists.map((l) => l.url) }) })

// 3) notes WebDAV account — direct DB insert, replicating caldav.js AES-256-GCM.
const config = await import(path.join(HERE, '..', '..', 'app', 'server', 'config.js'))
const KEY = crypto.createHash('sha256').update(process.env.CALDAV_ENC_KEY || process.env.SESSION_SECRET || 'dev-insecure').digest()
const enc = (plain) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}
await config.insertAccount({ id: 'ca-notes', user_id: USER, name: 'Notes', type: 'generic', server_url: `http://${IP}:8081`, username: 'e2e', password_enc: enc('e2epw') })
await config.setNotesConfig(USER, 'ca-notes', 'Notes')
console.log('notes account ca-notes -> http://' + IP + ':8081/files/e2e/  (root: Notes)')

// 4) figure out a task project + an event-capable list for the specs.
const projects = await api('/api/projects')
const taskProject = projects.find((p) => /tasks/i.test(p.title || '')) || projects[0]
// The seeded "Tasks" calendar supports VEVENT; the auto "Reminders" list is
// VTODO-only and would reject a VEVENT PUT, so prefer the /tasks/ collection.
const eventList = lists.find((l) => /\/tasks\/?$/.test(l.url)) || lists[0]

const out = {
  ip: IP, baseURL: BASE, user: USER, accountId,
  taskProjectId: taskProject?.id || null,
  taskProjectTitle: taskProject?.title || null,
  projects: projects.map((p) => ({ id: p.id, title: p.title })),
  eventList: eventList ? { accountId, listUrl: eventList.url } : null,
}
fs.writeFileSync(path.join(STATE, 'e2e.json'), JSON.stringify(out, null, 2))
console.log('wrote .state/e2e.json:', JSON.stringify(out))
