#!/usr/bin/env bash
# Restart ONLY the BFF, preserving the config DB (accounts + provisioning) — for
# iterating on server code without a full rebuild/reprovision. Rebuilds the SPA
# only when --build is passed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STATE="$HERE/.state"
IP="$(cat "$STATE/ip")"

pkill -f 'server/index.js' 2>/dev/null || true
sleep 1

if [ "${1:-}" = "--build" ]; then ( cd "$REPO/app" && npm run build >"$STATE/build.log" 2>&1 ) || { echo "build failed"; tail -20 "$STATE/build.log"; exit 1; }; fi

export NODE_ENV=development ALLOW_DEV_BYPASS=1 COOKIE_INSECURE=1 PORT=8080
export SESSION_SECRET=e2e-secret CALDAV_ENC_KEY=e2e-enc-key
export CONFIG_DB_PATH="$STATE/config.e2e.db" REMINDER_POLL_MS=15000
cd "$REPO/app"
nohup node server/index.js >"$STATE/bff.log" 2>&1 &
echo $! > "$STATE/bff.pid"
cd "$HERE"
for _ in $(seq 1 40); do curl -sf "http://$IP:8080/healthz" >/dev/null && { echo "BFF restarted (pid $(cat "$STATE/bff.pid"))"; exit 0; }; sleep 0.5; done
echo "FATAL: BFF did not come up"; tail -20 "$STATE/bff.log"; exit 1
