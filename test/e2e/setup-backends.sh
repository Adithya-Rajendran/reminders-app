#!/usr/bin/env bash
# Start the two local backends the app talks to — a CalDAV server (Radicale, for
# VTODO tasks / VEVENT events / VALARM reminders) and a generic WebDAV files
# server (wsgidav, for Markdown notes). Both bind 0.0.0.0 and are addressed via
# the host's first non-loopback IPv4: the app's SSRF guard ALWAYS blocks
# 127.x/169.254.x (caldav.js ipBlocked), so localhost is unusable on purpose.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/.state"
VENV="$HERE/.venv"
mkdir -p "$STATE/collections" "$STATE/filesroot"

# Bootstrap the Python venv (CalDAV + WebDAV servers) on first run / in CI.
if [ ! -x "$VENV/bin/radicale" ]; then
  echo "  creating venv + installing radicale/wsgidav ..."
  "${PYTHON:-python3}" -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet 'radicale==3.*' wsgidav cheroot
fi

# First non-loopback IPv4. NOT filtered to RFC1918: this sandbox reports
# 192.0.2.2 (TEST-NET) which is not private but still passes the guard
# (ipBlocked falls through to "allowed"); CI runners report a 10.x address.
IP="$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -vE '^127\.' | head -n1 || true)"
[ -n "$IP" ] || { echo "FATAL: no non-loopback IPv4 from 'hostname -I'"; exit 1; }
printf '%s' "$IP" > "$STATE/ip"
echo "E2E_IP=$IP"

# --- Radicale (CalDAV) ---
printf 'e2e:e2epw\n' > "$STATE/users.htpasswd"
cat > "$STATE/radicale.config" <<EOF
[server]
hosts = 0.0.0.0:5232
[auth]
type = htpasswd
htpasswd_filename = $STATE/users.htpasswd
htpasswd_encryption = plain
[storage]
filesystem_folder = $STATE/collections
[logging]
level = warning
EOF

# --- wsgidav (WebDAV files for notes) ---
# webdav.js builds ${server_url}/files/${username}/, so the share prefix must be
# exactly /files/e2e. property_manager gives stable ETags (notes need If-Match).
cat > "$STATE/wsgidav.yaml" <<EOF
host: 0.0.0.0
port: 8081
provider_mapping:
  "/files/e2e": "$STATE/filesroot"
http_authenticator:
  accept_basic: true
  accept_digest: false
  default_to_digest: false
simple_dc:
  user_mapping:
    "*":
      "e2e":
        password: "e2epw"
property_manager: true
lock_storage: true
logging:
  enable_loggers: []
EOF

# Free the ports if a previous run left something behind.
bash "$HERE/teardown.sh" >/dev/null 2>&1 || true

"$VENV/bin/radicale" --config "$STATE/radicale.config" >"$STATE/radicale.log" 2>&1 &
echo $! > "$STATE/radicale.pid"
"$VENV/bin/wsgidav" --config "$STATE/wsgidav.yaml" >"$STATE/wsgidav.log" 2>&1 &
echo $! > "$STATE/wsgidav.pid"

# Wait until each port answers (any HTTP status, incl. 401, means it's up).
wait_up() { # name url
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "$2"; then echo "  $1 up"; return 0; fi
    sleep 0.5
  done
  echo "FATAL: $1 did not come up ($2)"; cat "$STATE/$1.log" 2>/dev/null || true; exit 1
}
wait_up radicale "http://$IP:5232/"
wait_up wsgidav  "http://$IP:8081/files/e2e/"

# Seed one CalDAV calendar (VTODO+VEVENT) so the app's discovery has a
# calendar-home to derive — without it the auto "Reminders" list is skipped.
echo "  MKCALENDAR e2e/tasks ..."
curl -sf -u e2e:e2epw -X MKCALENDAR "http://$IP:5232/e2e/tasks/" \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary '<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>
<D:displayname>Tasks</D:displayname>
<C:supported-calendar-component-set><C:comp name="VTODO"/><C:comp name="VEVENT"/></C:supported-calendar-component-set>
</D:prop></D:set></C:mkcalendar>' >/dev/null || echo "  (MKCALENDAR returned non-2xx; may already exist)"

# Confirm the calendar is discoverable + ETags work (notes depend on getetag).
curl -sf -u e2e:e2epw -X PROPFIND -H 'Depth: 1' "http://$IP:5232/e2e/" >/dev/null \
  || { echo "FATAL: Radicale PROPFIND /e2e/ failed"; exit 1; }
echo "backends ready on $IP (radicale :5232, wsgidav :8081)"
