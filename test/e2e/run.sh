#!/usr/bin/env bash
# Local one-shot: bring up backends + BFF, provision, run Playwright, tear down.
# (CI runs the same steps individually — see .github/workflows/ci.yml.)
# Runs unmodified on GitHub-hosted ubuntu-latest — no self-hosted infra, VM, or
# cluster required.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() { bash "$HERE/teardown.sh" >/dev/null 2>&1 || true; }
trap cleanup EXIT

bash "$HERE/setup-backends.sh"
# Share the same secrets/DB between the BFF and the provision step.
export SESSION_SECRET="${SESSION_SECRET:-e2e-secret}"
export CALDAV_ENC_KEY="${CALDAV_ENC_KEY:-e2e-enc-key}"
export CONFIG_DB_PATH="${CONFIG_DB_PATH:-$HERE/.state/config.e2e.db}"
bash "$HERE/start-bff.sh"
node "$HERE/provision.mjs"

( cd "$HERE" && npx playwright test "$@" )
