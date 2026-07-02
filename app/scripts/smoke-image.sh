#!/usr/bin/env bash
# Boot the production image and verify the unauthenticated surface. Catches the
# class of bug that shipped once already: the server imports client/src at
# module load (see Dockerfile runtime COPY), so a missing file crashes on BOOT,
# not on build — a build-only CI job waves it through. Host curl to 127.0.0.1
# here is the runner hitting a published port — unrelated to the app's CalDAV
# SSRF guard (which covers only the BFF's OUTBOUND fetches).
set -euo pipefail
# Inert on Linux/CI; stops Git-Bash (MSYS) from rewriting container paths like
# /tmp/config.db into Windows paths when this script is run locally on Windows.
export MSYS_NO_PATHCONV=1
IMAGE="${1:?usage: smoke-image.sh <image> [port]}"
PORT="${2:-18080}"

docker rm -f smoke >/dev/null 2>&1 || true
# ALLOW_DEV_BYPASS=1 is injected ON PURPOSE: the production double-gate
# (NODE_ENV=production baked into the image) must keep it dead — asserted below.
docker run -d --name smoke \
  -e SESSION_SECRET=ci-smoke-only-secret \
  -e CONFIG_DB_PATH=/tmp/config.db \
  -e ALLOW_DEV_BYPASS=1 \
  --tmpfs /tmp:rw,mode=1777,size=64m \
  --health-interval=2s --health-retries=5 --health-start-period=0s \
  -p 127.0.0.1:"$PORT":8080 \
  "$IMAGE"

# No --rm on the run: logs must survive a crash-on-boot for the trap to show.
cleanup() { docker logs smoke 2>&1 | tail -n 50 || true; docker rm -f smoke >/dev/null 2>&1 || true; }
trap cleanup EXIT

up=""
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Running}}' smoke)" = "true" ] || break # died = crash-on-boot
  if curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -q '"ok":true'; then up=1; break; fi
  sleep 1
done
[ -n "$up" ] || { echo '::error::runtime image failed to serve /healthz'; exit 1; }

# SPA index via the static fallback + a hashed asset it references really
# exists. Buffer the body: piping curl straight into `grep -q` EPIPEs curl when
# grep exits on the first match, which set -o pipefail turns into a failure.
index_html=$(curl -fsS "http://127.0.0.1:$PORT/")
echo "$index_html" | grep -q '<div id="root">' || { echo '::error::index.html is not the SPA shell'; exit 1; }
asset=$(echo "$index_html" | grep -o '/assets/[^"]*\.js' | head -n1)
[ -n "$asset" ] || { echo '::error::index.html references no /assets js bundle'; exit 1; }
curl -fsSo /dev/null "http://127.0.0.1:$PORT$asset"

# /mcp without a bearer token must 401 (uniform unauthorized contract).
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' "http://127.0.0.1:$PORT/mcp")
[ "$code" = "401" ] || { echo "::error::/mcp without token returned $code"; exit 1; }

# The dev bypass must be dead in a production image even when its env leaks in.
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-dev-user: smoke' "http://127.0.0.1:$PORT/api/me")
[ "$code" = "401" ] || { echo "::error::dev bypass alive in production image ($code)"; exit 1; }

# The image's own HEALTHCHECK must also pass — compose/k8s users rely on it.
for _ in $(seq 1 10); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' smoke)" = "healthy" ] && { echo 'smoke: all checks passed'; exit 0; }
  sleep 1
done
echo '::error::container HEALTHCHECK never reported healthy'
docker inspect -f '{{json .State.Health}}' smoke
exit 1
