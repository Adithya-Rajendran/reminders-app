#!/usr/bin/env bash
# Build (unless --no-rebuild / NO_REBUILD=1) and start the BFF as a Docker
# container from the app's own `runtime` image stage (built SPA + server +
# pruned prod node_modules — see app/Dockerfile), then provision it: a
# CalDAV account (Radicale) through the real API, and a notes WebDAV account
# (which can't pass CalDAV discovery, so it's inserted directly the same way
# test/e2e/provision.mjs does — here via `docker exec` into the running
# container, reusing its own already-compiled server/config.js + better-
# sqlite3 instead of installing a second, ABI-matched copy on the host).
#
# Adapted from test/e2e/start-bff.sh + test/e2e/provision.mjs; never edits
# either. Auth runs in dev-bypass mode (x-dev-user header) same as the e2e
# harness — see app/server/index.js requireAuth.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
STATE="$HERE/.state"
IP="$(cat "$STATE/ip")"
mkdir -p "$STATE"

IMAGE="shots-bff:local"
NO_REBUILD="${NO_REBUILD:-0}"
for a in "$@"; do [ "$a" = "--no-rebuild" ] && NO_REBUILD=1; done

if [ "$NO_REBUILD" = "1" ] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "  skipping rebuild ($IMAGE already exists, --no-rebuild)"
else
  echo "  building $IMAGE (target=runtime) ..."
  docker build --target runtime -t "$IMAGE" -f "$REPO/app/Dockerfile" "$REPO/app"
fi

export SESSION_SECRET="${SESSION_SECRET:-shots-secret}"
export CALDAV_ENC_KEY="${CALDAV_ENC_KEY:-shots-enc-key}"
DB_HOST="$STATE/config.shots.db"
# Fresh DB each run so seeded data is deterministic.
rm -f "$DB_HOST" "$DB_HOST"-wal "$DB_HOST"-shm 2>/dev/null || true

docker rm -f shots-bff >/dev/null 2>&1 || true

# --user keeps the sqlite file + WAL/SHM host-owned; the runtime image's own
# files (node_modules/public/server) stay root-owned but world-readable, which
# is all a non-owning UID needs.
docker run -d --name shots-bff --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e NODE_ENV=development \
  -e ALLOW_DEV_BYPASS=1 \
  -e COOKIE_INSECURE=1 \
  -e PORT=8080 \
  -e SESSION_SECRET="$SESSION_SECRET" \
  -e CALDAV_ENC_KEY="$CALDAV_ENC_KEY" \
  -e CONFIG_DB_PATH=/state/config.shots.db \
  -e REMINDER_POLL_MS="${REMINDER_POLL_MS:-3600000}" \
  -v "$STATE:/state" \
  "$IMAGE" >/dev/null

echo "  waiting for BFF on $IP:8080 ..."
up=0
for _ in $(seq 1 60); do
  if curl -sf --max-time 2 "http://$IP:8080/healthz" >/dev/null; then up=1; break; fi
  sleep 0.5
done
[ "$up" = "1" ] || { echo "FATAL: BFF did not become healthy"; docker logs --tail 60 shots-bff; exit 1; }
echo "  BFF healthy"

# ---- provision: CalDAV account (Radicale) + notes WebDAV account ----
# Written to .state (bind-mounted at /state in the container) so it can just
# be exec'd in place — no docker cp, no image rebuild for a one-off script.
cat > "$STATE/provision.mjs" <<'JS'
// Runs inside the shots-bff container (docker exec) — see start-bff.sh.
//   1. add the Radicale CalDAV account through the REAL API (exercises
//      discovery + the auto "Reminders" calendar creation),
//   2. enable all discovered lists,
//   3. insert the notes WebDAV account directly into the config DB (a
//      pure-WebDAV server can't pass CalDAV discovery, so it can't go
//      through the API — same trick as test/e2e/provision.mjs), using the
//      container's own server/config.js so the AES-256-GCM encryption is
//      byte-for-byte what caldav.js will decrypt later,
//   4. write { ip, baseURL, user, accountId, taskProjectId, eventList } to
//      /state/shots.json directly (NOT via stdout — server/config.js logs an
//      unconditional "sqlite config db ready..." line on import, which would
//      corrupt a stdout-redirected JSON file).
import crypto from 'node:crypto'
import fs from 'node:fs'
import * as config from '/app/server/config.js'

const IP = process.env.SHOTS_IP
const USER = 'shots-user'
const HDR = { 'x-dev-user': USER, 'content-type': 'application/json' }
const BASE = 'http://127.0.0.1:8080' // same container -> loopback is fine here

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { ...HDR, ...(opts.headers || {}) } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${p} -> ${res.status}: ${text}`)
  return body
}

const add = await api('/api/caldav/accounts', {
  method: 'POST',
  body: JSON.stringify({ name: 'Radicale', type: 'generic', serverUrl: `http://${IP}:5232/`, username: 'shots', password: 'shotspw' }),
})
const accountId = add.account.id
const lists = add.account.lists || []
await api(`/api/caldav/accounts/${accountId}/lists`, { method: 'PUT', body: JSON.stringify({ enabled: lists.map((l) => l.url) }) })

const KEY = crypto.createHash('sha256').update(process.env.CALDAV_ENC_KEY || 'dev-insecure').digest()
const enc = (plain) => {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}
await config.insertAccount({ id: 'ca-notes', user_id: USER, name: 'Notes', type: 'generic', server_url: `http://${IP}:8081`, username: 'shots', password_enc: enc('shotspw') })
await config.setNotesConfig(USER, 'ca-notes', 'Notes')

const projects = await api('/api/projects')
const taskProject = projects.find((p) => /tasks/i.test(p.title || '')) || projects[0]
// The seeded "Tasks" calendar supports VEVENT; the auto "Reminders" list is
// VTODO-only and would reject a VEVENT PUT, so prefer the /tasks/ collection.
const eventList = lists.find((l) => /\/tasks\/?$/.test(l.url)) || lists[0]

fs.writeFileSync('/state/shots.json', JSON.stringify({
  ip: IP, baseURL: BASE.replace('127.0.0.1', IP), user: USER, accountId,
  taskProjectId: taskProject?.id ?? null,
  projects: projects.map((p) => ({ id: p.id, title: p.title })),
  eventList: eventList ? { accountId, listUrl: eventList.url } : null,
}))
console.log('provisioned OK')
JS

echo "  provisioning CalDAV account + notes WebDAV account ..."
if ! docker exec -e SHOTS_IP="$IP" -e CALDAV_ENC_KEY="$CALDAV_ENC_KEY" shots-bff node /state/provision.mjs; then
  echo "FATAL: provisioning failed"; docker logs --tail 60 shots-bff; exit 1
fi
echo "  wrote .state/shots.json: $(cat "$STATE/shots.json")"
