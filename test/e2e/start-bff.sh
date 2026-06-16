#!/usr/bin/env bash
# Build the SPA and start the BFF (server/index.js) on 0.0.0.0:8080, serving the
# built SPA same-origin (simplest for Playwright cookies + exercises the real
# static/SPA-fallback path). Auth runs in dev-bypass mode so Playwright can
# authenticate via the x-dev-user header instead of standing up OIDC.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STATE="$HERE/.state"
IP="$(cat "$STATE/ip")"
mkdir -p "$STATE"

export NODE_ENV=development
export ALLOW_DEV_BYPASS=1
export COOKIE_INSECURE=1
export PORT=8080
export SESSION_SECRET="${SESSION_SECRET:-e2e-secret}"
export CALDAV_ENC_KEY="${CALDAV_ENC_KEY:-e2e-enc-key}"
export CONFIG_DB_PATH="${CONFIG_DB_PATH:-$STATE/config.e2e.db}"
export REMINDER_POLL_MS="${REMINDER_POLL_MS:-15000}"
# Persist the env the provision step + Playwright must share (same enc key + DB).
cat > "$STATE/bff.env" <<EOF
SESSION_SECRET=$SESSION_SECRET
CALDAV_ENC_KEY=$CALDAV_ENC_KEY
CONFIG_DB_PATH=$CONFIG_DB_PATH
EOF

# Fresh DB each run so seeded data is deterministic.
rm -f "$CONFIG_DB_PATH" "$CONFIG_DB_PATH"-wal "$CONFIG_DB_PATH"-shm 2>/dev/null || true

echo "  building SPA ..."
( cd "$REPO/app" && npm run build >"$STATE/build.log" 2>&1 ) || { echo "FATAL: build failed"; tail -30 "$STATE/build.log"; exit 1; }

echo "  starting BFF on $IP:8080 ..."
# Start without a subshell so $! is the real node PID (teardown must kill node,
# not a wrapper that has already exited).
cd "$REPO/app"
nohup node server/index.js >"$STATE/bff.log" 2>&1 &
echo $! > "$STATE/bff.pid"
cd "$HERE"

for _ in $(seq 1 60); do
  if curl -sf --max-time 2 "http://$IP:8080/healthz" >/dev/null; then echo "  BFF healthy"; exit 0; fi
  sleep 0.5
done
echo "FATAL: BFF did not become healthy"; tail -40 "$STATE/bff.log"; exit 1
