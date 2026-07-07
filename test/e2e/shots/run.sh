#!/usr/bin/env bash
# One-shot: bring up backends + BFF, provision, seed + shoot one or more
# boards, tear down (unless --keep-up). Idempotent — safe to re-run even with
# leftover shots-* containers from an interrupted previous run.
#
#   bash run.sh --step <name> [--board showcase|empty|no-widgets|all] [--no-rebuild] [--keep-up]
#   bash run.sh --diff <stepA> <stepB>
#
# See README.md for the full option reference and the port-collision note
# (this harness and test/e2e/ can't run at the same time — both use
# 5232/8081/8080 on --network host).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

# node_modules is gitignored (installed inside a container so it stays host-
# owned) — install once, reused across runs. Pure-JS deps only (playwright-
# core/pixelmatch/pngjs), so the install image doesn't need to match whatever
# image later RUNS the scripts.
ensure_deps() {
  if [ ! -d "$HERE/node_modules" ]; then
    echo "  installing shots/ node_modules (node:22-bookworm-slim, npm ci)..."
    docker run --rm --network host \
      --user "$(id -u):$(id -g)" -e HOME=/tmp -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
      -v "$HERE:/work" -w /work \
      node:22-bookworm-slim npm ci --no-audit --no-fund
  fi
}

STEP=""
BOARD="all"
NO_REBUILD=0
KEEP_UP=0
DIFF_A=""
DIFF_B=""
while [ $# -gt 0 ]; do
  case "$1" in
    --step) STEP="$2"; shift 2;;
    --board) BOARD="$2"; shift 2;;
    --no-rebuild) NO_REBUILD=1; shift;;
    --keep-up) KEEP_UP=1; shift;;
    --diff) DIFF_A="$2"; DIFF_B="$3"; shift 3;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

# ---- --diff mode: pure pixel comparison, no backends/BFF needed ----
if [ -n "$DIFF_A" ]; then
  ensure_deps
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$HERE:/shots" -w /shots \
    node:22-bookworm-slim node diff.mjs "$DIFF_A" "$DIFF_B"
  exit $?
fi

[ -n "$STEP" ] || { echo "usage: run.sh --step <name> [--board showcase|empty|no-widgets|all] [--no-rebuild] [--keep-up]"; echo "       run.sh --diff <stepA> <stepB>"; exit 1; }
case "$BOARD" in
  showcase|empty|no-widgets) BOARDS=("$BOARD");;
  all) BOARDS=(showcase empty no-widgets);;
  *) echo "unknown --board: $BOARD (want showcase|empty|no-widgets|all)"; exit 1;;
esac

cleanup() { [ "$KEEP_UP" = "1" ] || bash "$HERE/teardown.sh" >/dev/null 2>&1 || true; }
trap cleanup EXIT

bash "$HERE/teardown.sh" >/dev/null 2>&1 || true # clear any leftovers first (idempotent re-run)
bash "$HERE/setup-backends.sh"
NO_REBUILD_FLAG=(); [ "$NO_REBUILD" = "1" ] && NO_REBUILD_FLAG=(--no-rebuild)
bash "$HERE/start-bff.sh" "${NO_REBUILD_FLAG[@]}"

ensure_deps

# The Playwright image tag is DERIVED from test/e2e's own lockfile at runtime
# — never hardcoded — so a Playwright bump there is picked up automatically.
# (test/e2e/package-lock.json is only READ here, never modified.)
PW_VERSION="$(python3 -c "
import json
with open('$REPO/test/e2e/package-lock.json') as f:
    d = json.load(f)
print(d['packages']['node_modules/@playwright/test']['version'])
")"
PW_IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
echo "  playwright image: $PW_IMAGE (derived from test/e2e/package-lock.json)"

for b in "${BOARDS[@]}"; do
  echo "== board: $b =="
  echo "  seeding ($b)..."
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$HERE:/shots" -v "$REPO:/repo:ro" -w /shots \
    node:22-bookworm-slim node "seed-$b.mjs"

  echo "  capturing ($b)..."
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$HERE:/shots" -v "$REPO:/repo:ro" -w /shots \
    "$PW_IMAGE" node capture.mjs --step "$STEP" --board "$b"
done

n="$(find "$HERE/output/$STEP" -name '*.png' 2>/dev/null | wc -l)"
echo "done: $n PNG(s) in test/e2e/shots/output/$STEP/"
