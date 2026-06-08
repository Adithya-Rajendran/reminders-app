// Stable, URL-safe identifiers for the CalDAV task store.
//
// - project_id stays a positive integer (caldav_lists.id) so the SPA is unchanged.
// - task.id is opaque: base64url("<listId><objectUrl>"). listId gives an
//   O(1), ownership-checked resolution of the account + list; objectUrl is the
//   exact href for GET/PUT/DELETE. (The reminder poller encodes ids the same way
//   so RemindersWidget complete/snooze round-trips.)
// - label_id is "cat_" + base64url(categoryName) — CATEGORIES are free text.
// SEP is the ASCII Unit Separator (0x1F): a control byte that never appears in a
// listId (digits) or a CalDAV objectUrl (an http(s) URL), so it unambiguously
// splits the two halves after base64url-decoding.
const SEP = '\x1f'
const b64url = (s) => Buffer.from(String(s), 'utf8').toString('base64url')
const unb64url = (s) => Buffer.from(String(s), 'base64url').toString('utf8')

export function encodeTaskId(listId, objectUrl) {
  return b64url(`${listId}${SEP}${objectUrl}`)
}

// Returns { listId:number, objectUrl:string }. Throws on a malformed id so the
// handler can answer 400 rather than mis-route.
export function decodeTaskId(id) {
  let raw
  try { raw = unb64url(id) } catch { const e = new Error('bad task id'); e.status = 400; throw e }
  const i = raw.indexOf(SEP)
  if (i < 0) { const e = new Error('bad task id'); e.status = 400; throw e }
  const listId = Number(raw.slice(0, i))
  const objectUrl = raw.slice(i + 1)
  if (!Number.isInteger(listId) || listId <= 0 || !objectUrl) { const e = new Error('bad task id'); e.status = 400; throw e }
  return { listId, objectUrl }
}

export const encodeLabelId = (name) => 'cat_' + b64url(name)
export const decodeLabelId = (id) => unb64url(String(id).replace(/^cat_/, ''))
