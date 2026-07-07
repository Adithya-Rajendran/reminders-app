#!/usr/bin/env bash
# Start the two local backends the shots harness talks to — a CalDAV server
# (Radicale, VTODO/VEVENT) and a WebDAV files server (wsgidav, notes) — as
# Docker containers built from docker/backends.Dockerfile. Adapted from
# test/e2e/setup-backends.sh (same config heredocs, same non-loopback-IP
# convention — app/server/caldav.js blocks 127.x/169.254.x unconditionally, so
# localhost is unusable on purpose); NEVER edits that file. Uses the "shots"
# realm (creds/paths) throughout so nothing collides with the e2e harness's
# "e2e" realm if their state directories were ever mixed up.
#
# Idempotent: safe to re-run (removes any leftover shots-radicale/shots-wsgidav
# containers first). Shares ports 5232/8081 with test/e2e — don't run both
# harnesses at once (see README.md).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/.state"
IMAGE="shots-backends:local"
mkdir -p "$STATE/collections" "$STATE/filesroot"

echo "  building $IMAGE ..."
docker build -q -t "$IMAGE" -f "$HERE/docker/backends.Dockerfile" "$HERE/docker" >/dev/null

# First non-loopback IPv4 — see test/e2e/setup-backends.sh for why (SSRF guard
# always blocks 127.x, so the app can never reach a backend on localhost).
IP="$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^127\.' | head -n1 || true)"
[ -n "$IP" ] || { echo "FATAL: no non-loopback IPv4 from 'hostname -I'"; exit 1; }
printf '%s' "$IP" > "$STATE/ip"
echo "SHOTS_IP=$IP"

# --- Radicale (CalDAV) config ---
printf 'shots:shotspw\n' > "$STATE/users.htpasswd"
cat > "$STATE/radicale.config" <<'EOF'
[server]
hosts = 0.0.0.0:5232
[auth]
type = htpasswd
htpasswd_filename = /state/users.htpasswd
htpasswd_encryption = plain
[storage]
filesystem_folder = /state/collections
[logging]
level = warning
EOF

# --- wsgidav (WebDAV files for notes) config ---
# webdav.js builds ${server_url}/files/${username}/, so the share prefix must be
# exactly /files/shots. property_manager gives stable ETags (notes need If-Match).
cat > "$STATE/wsgidav.yaml" <<'EOF'
host: 0.0.0.0
port: 8081
provider_mapping:
  "/files/shots": "/state/filesroot"
http_authenticator:
  accept_basic: true
  accept_digest: false
  default_to_digest: false
simple_dc:
  user_mapping:
    "*":
      "shots":
        password: "shotspw"
property_manager: true
lock_storage: true
logging:
  enable_loggers: []
EOF

docker rm -f shots-radicale shots-wsgidav >/dev/null 2>&1 || true

docker run -d --name shots-radicale --network host \
  --user "$(id -u):$(id -g)" \
  -v "$STATE:/state" \
  "$IMAGE" radicale --config /state/radicale.config >/dev/null

docker run -d --name shots-wsgidav --network host \
  --user "$(id -u):$(id -g)" \
  -v "$STATE:/state" \
  "$IMAGE" wsgidav --config /state/wsgidav.yaml >/dev/null

# Wait until each port answers (any HTTP status, incl. 401, means it's up).
wait_up() { # name url
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "$2"; then echo "  $1 up"; return 0; fi
    sleep 0.5
  done
  echo "FATAL: $1 did not come up ($2)"; docker logs --tail 60 "shots-$1" 2>&1 || true; exit 1
}
wait_up radicale "http://$IP:5232/"
wait_up wsgidav  "http://$IP:8081/files/shots/"

# Seed one CalDAV calendar (VTODO+VEVENT) so the app's discovery has a
# calendar-home to derive — without it the auto "Reminders" list is skipped.
echo "  MKCALENDAR shots/tasks ..."
curl -sf -u shots:shotspw -X MKCALENDAR "http://$IP:5232/shots/tasks/" \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary '<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>
<D:displayname>Tasks</D:displayname>
<C:supported-calendar-component-set><C:comp name="VTODO"/><C:comp name="VEVENT"/></C:supported-calendar-component-set>
</D:prop></D:set></C:mkcalendar>' >/dev/null || echo "  (MKCALENDAR returned non-2xx; may already exist)"

# Confirm the calendar is discoverable + ETags work (notes depend on getetag).
curl -sf -u shots:shotspw -X PROPFIND -H 'Depth: 1' "http://$IP:5232/shots/" >/dev/null \
  || { echo "FATAL: Radicale PROPFIND /shots/ failed"; exit 1; }
echo "backends ready on $IP (radicale :5232, wsgidav :8081)"
