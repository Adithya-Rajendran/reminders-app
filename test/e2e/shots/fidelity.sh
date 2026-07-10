#!/usr/bin/env bash
# Fidelity mode: run the REAL resize-polish e2e audit
# (test/e2e/specs/resize-polish.spec.mjs) against this harness's own
# shots-radicale/shots-wsgidav/shots-bff (setup-backends.sh/start-bff.sh,
# UNCHANGED, same as run.sh uses), producing a full per-widget x per-scenario
# (min/standard/wide/tall/max) screenshot matrix plus the spec's own contact
# sheets — a locally-reproducible visual-fidelity check for the resize audit
# that CI runs headless-and-assertion-only.
#
#   bash fidelity.sh --step <name> [--theme dark|light|both] [--no-rebuild] [--keep-up] [-- <extra playwright args>]
#
# NEVER edits test/e2e/{run.sh,setup-backends.sh,start-bff.sh,provision.mjs,
# playwright.config.mjs,lib.mjs} — those are test/e2e's own CI-facing files.
# Instead this script:
#   1. brings up the SAME shots-* backends/BFF `run.sh` uses (unmodified
#      setup-backends.sh/start-bff.sh, "shots" realm/creds/state — see README);
#   2. bridges this run's .state/shots.json into what
#      test/e2e/playwright.config.mjs + test/e2e/lib.mjs actually read: the
#      FILE convention (test/e2e/.state/{ip,e2e.json} — the same shape
#      test/e2e/provision.mjs itself writes for a real e2e run) for lib.mjs's
#      task-project-id/event-list lookups, AND the E2E_USER env var for
#      playwright.config.mjs's `x-dev-user` header (that header does NOT come
#      from the state file — it defaults to the literal 'e2e-user', which the
#      shots-bff has never provisioned, so it needs the env var too). So the
#      spec runs completely unmodified in every way that matters to its own
#      logic;
#   3. installs test/e2e's OWN node_modules (@playwright/test — separate
#      lockfile from this dir's shots/package-lock.json) inside a container,
#      never on the host (see README's "Why Docker for everything" — host
#      node is v24 here, ABI-mismatched with this repo's native deps, and
#      app checkouts can have root-owned files);
#   4. runs specs/resize-polish.spec.mjs inside
#      mcr.microsoft.com/playwright:v<version>-noble, where <version> is
#      DERIVED from test/e2e/package-lock.json at runtime (identical
#      derivation to run.sh's capture step — never hardcoded);
#   5. copies the spec's own artifacts (test/e2e/.artifacts/ — full-page
#      screenshots aren't produced here, but resize-shots/<viewport>/<type>/
#      <scenario>.png, contact-<viewport>.png and resize-results.json are)
#      into test/e2e/shots/output/fidelity-<step>/<theme>/, then restores
#      whatever was previously in test/e2e/.state/{ip,e2e.json} (if anything)
#      so this never leaves a stray footprint in test/e2e/'s own state dir.
#
# Two env hooks on the spec itself are used here (both default OFF/no-op —
# see resize-polish.spec.mjs's own comments for exactly what they gate):
#   RESIZE_SHOTS=all    capture the full widget x scenario matrix even when a
#                        scenario has audit issues, instead of aborting the
#                        loop (and skipping every widget after it) on the
#                        first failure the way CI's fail-fast run does.
#   RESIZE_THEME=dark|light   force the app's pre-paint theme before every
#                        navigation in the spec (the app's own default,
#                        i.e. RESIZE_THEME unset, is 'dark' — see
#                        app/client/src/host/theme.js normalizeThemePref).
#
# Same port-collision rule as run.sh: don't run this at the same time as
# `test/e2e/run.sh` OR `test/e2e/shots/run.sh` (all three bind
# 5232/8081/8080 on --network host).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
E2E="$REPO/test/e2e"
E2E_STATE="$E2E/.state"
BRIDGE_BACKUP="$HERE/.state/.e2e-bridge-backup"

STEP=""
THEME_ARG="both"
NO_REBUILD=0
KEEP_UP=0
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --step) STEP="$2"; shift 2;;
    --theme) THEME_ARG="$2"; shift 2;;
    --no-rebuild) NO_REBUILD=1; shift;;
    --keep-up) KEEP_UP=1; shift;;
    --) shift; EXTRA_ARGS=("$@"); break;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done
[ -n "$STEP" ] || { echo "usage: fidelity.sh --step <name> [--theme dark|light|both] [--no-rebuild] [--keep-up] [-- <extra playwright args>]"; exit 1; }
case "$THEME_ARG" in
  dark|light) THEMES=("$THEME_ARG");;
  both) THEMES=(dark light);;
  *) echo "unknown --theme: $THEME_ARG (want dark|light|both)"; exit 1;;
esac

# ---- restore test/e2e/.state/{ip,e2e.json} to whatever they were before this
# script ran (or remove them if they didn't exist) — this script is the only
# thing in the fidelity mode that touches anything under test/e2e/ itself, and
# it's a transient bridge file, not a real e2e-harness run, so it shouldn't be
# left behind for a later `test/e2e/run.sh` to trip over. ----
restore_bridge() {
  for f in ip e2e.json; do
    if [ -f "$BRIDGE_BACKUP/$f.orig" ]; then
      mv -f "$BRIDGE_BACKUP/$f.orig" "$E2E_STATE/$f"
    else
      rm -f "$E2E_STATE/$f"
    fi
  done
  rm -rf "$BRIDGE_BACKUP"
}
cleanup() {
  restore_bridge
  [ "$KEEP_UP" = "1" ] || bash "$HERE/teardown.sh" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---- concurrency tripwire: the shots-* container NAMES and host ports are
# global, so a second harness invocation (this script, run.sh, or another
# checkout's copy) clobbers a live one — its teardown/`docker rm -f` kills the
# first run's BFF mid-test, which surfaces downstream as ECONNREFUSED audits
# and partial/foreign artifacts. A capture/spec container from either harness
# is a `docker run --rm` one-shot on the mcr playwright image, so one RUNNING
# now means a run is actively mid-flight (a crashed run leaves none behind) —
# refuse to start rather than corrupt it. FIDELITY_FORCE=1 overrides.
if [ "${FIDELITY_FORCE:-0}" != "1" ] && docker ps --format '{{.Image}}' | grep -q '^mcr.microsoft.com/playwright:'; then
  echo "FATAL: a Playwright container is running — another shots/e2e harness run appears to be in progress." >&2
  echo "       Wait for it to finish (docker ps), or set FIDELITY_FORCE=1 to clobber it anyway." >&2
  KEEP_UP=1 # don't let our EXIT trap tear down the other run's containers
  exit 1
fi

bash "$HERE/teardown.sh" >/dev/null 2>&1 || true # clear any leftovers first (idempotent re-run)
bash "$HERE/setup-backends.sh"
NO_REBUILD_FLAG=(); [ "$NO_REBUILD" = "1" ] && NO_REBUILD_FLAG=(--no-rebuild)
bash "$HERE/start-bff.sh" "${NO_REBUILD_FLAG[@]}"

# ---- bridge .state/shots.json -> test/e2e/.state/{ip,e2e.json} ----
mkdir -p "$E2E_STATE" "$BRIDGE_BACKUP"
for f in ip e2e.json; do
  [ -f "$E2E_STATE/$f" ] && cp "$E2E_STATE/$f" "$BRIDGE_BACKUP/$f.orig"
done
# lib.mjs's STATE (task project id, event list) follows the FILE bridge above,
# but test/e2e/playwright.config.mjs's `x-dev-user` header does NOT read
# .state/e2e.json — it only reads the E2E_USER/DEV_VISUAL_USER env var
# (defaulting to the literal 'e2e-user', which the shots-bff has never heard
# of). Bridge that too, or every seeded request 404s/409s as an unconfigured
# user even though the file bridge above looks right.
SHOTS_USER="$(python3 -c "import json; print(json.load(open('$HERE/.state/shots.json'))['user'])")"
python3 - "$HERE/.state/shots.json" "$E2E_STATE" <<'PY'
import json, sys
shots_path, e2e_state = sys.argv[1], sys.argv[2]
shots = json.load(open(shots_path))
open(f"{e2e_state}/ip", "w").write(shots["ip"])
# Same shape test/e2e/provision.mjs writes (see lib.mjs's STATE fallback) —
# only the fields lib.mjs/the spec actually read are required; taskProjectTitle
# isn't (only used for a log line in the real provision.mjs).
e2e_json = {
    "ip": shots["ip"],
    "baseURL": shots["baseURL"],
    "user": shots["user"],
    "accountId": shots["accountId"],
    "taskProjectId": shots["taskProjectId"],
    "taskProjectTitle": None,
    "projects": shots.get("projects", []),
    "eventList": shots.get("eventList"),
}
json.dump(e2e_json, open(f"{e2e_state}/e2e.json", "w"), indent=2)
print(f"  bridged {shots_path} -> {e2e_state}/{{ip,e2e.json}} (ip={shots['ip']}, user={shots['user']})")
PY

# ---- install test/e2e's own node_modules (never npm/node on the host) ----
# The whole worktree (not just test/e2e/) is mounted, both here and for the
# playwright run below: lib.mjs imports the app's pure grid/manifest modules
# via a path RELATIVE to itself (`../../app/client/src/...`), so the container
# needs that same repo-relative structure on disk, not just test/e2e/ in
# isolation.
if [ ! -d "$E2E/node_modules" ]; then
  echo "  installing test/e2e/ node_modules (node:22-bookworm-slim, npm ci)..."
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    -v "$REPO:/repo" -w /repo/test/e2e \
    node:22-bookworm-slim npm ci --no-audit --no-fund
fi

# Playwright image tag DERIVED from test/e2e's own lockfile at runtime — same
# derivation run.sh uses for its capture step (test/e2e/package-lock.json is
# only READ here, never modified).
PW_VERSION="$(python3 -c "
import json
with open('$E2E/package-lock.json') as f:
    d = json.load(f)
print(d['packages']['node_modules/@playwright/test']['version'])
")"
PW_IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
echo "  playwright image: $PW_IMAGE (derived from test/e2e/package-lock.json)"

OVERALL_STATUS=0
for theme in "${THEMES[@]}"; do
  echo "== fidelity theme: $theme =="
  # Under RESIZE_SHOTS=all the spec deliberately does NOT clear its artifact
  # dir in beforeAll (a deferred failure restarts the Playwright worker, which
  # re-runs the hook — the unconditional rm would wipe the previous viewport's
  # already-written matrix mid-run), so the harness owns starting each theme
  # run clean instead.
  rm -rf "$E2E/.artifacts" "$E2E/test-results"
  STATUS=0
  docker run --rm --network host \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -e E2E_USER="$SHOTS_USER" \
    -e RESIZE_SHOTS=all \
    -e RESIZE_THEME="$theme" \
    -e RESIZE_WIDGET_FILTER="${RESIZE_WIDGET_FILTER:-}" \
    -v "$REPO:/repo" -w /repo/test/e2e \
    "$PW_IMAGE" npx playwright test specs/resize-polish.spec.mjs "${EXTRA_ARGS[@]}" || STATUS=$?
  if [ "$STATUS" != "0" ]; then
    echo "  (theme=$theme: spec reported issues — see resize-results.json below; artifacts were still written since RESIZE_SHOTS=all)"
    OVERALL_STATUS=1
  fi

  OUT="$HERE/output/fidelity-$STEP/$theme"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  if [ -d "$E2E/.artifacts" ]; then
    cp -r "$E2E/.artifacts/." "$OUT/"
  fi
  # Playwright's own per-failure artifacts (test-failed-*.png, trace.zip,
  # error-context.md) — only exists when something actually failed.
  if [ -d "$E2E/test-results" ] && [ -n "$(ls -A "$E2E/test-results" 2>/dev/null)" ]; then
    cp -r "$E2E/test-results" "$OUT/test-results"
  fi
  n="$(find "$OUT" -name '*.png' 2>/dev/null | wc -l)"
  echo "  wrote $n PNG(s) to test/e2e/shots/output/fidelity-$STEP/$theme/"

  # ---- collection guard: a "passed" audit whose artifacts are missing, or
  # whose renders came out in the WRONG theme, must fail loudly here rather
  # than be discovered later by eyeballing PNGs. The theme check reads the
  # `theme` field the spec stamps into every resize-results.json row (the
  # page's real <html data-theme> at shoot time) — if the rows carry no theme
  # at all, the spec predates the stamp (stale checkout) and that's an error
  # too: an unverifiable run is not a verified one. ----
  python3 - "$OUT" "$theme" <<'PY'
import glob, json, os, sys
out, theme = sys.argv[1], sys.argv[2]
problems = []
shots = glob.glob(f"{out}/resize-shots/**/*.png", recursive=True)
contacts = glob.glob(f"{out}/contact-*.png")
if not shots: problems.append("no per-scenario PNGs under resize-shots/")
if not contacts: problems.append("no contact-*.png sheets")
results = f"{out}/resize-results.json"
if not os.path.exists(results):
    problems.append("resize-results.json missing")
else:
    rows = json.load(open(results)).get("results", [])
    if not rows:
        problems.append("resize-results.json has zero rows")
    else:
        themes = {r.get("theme") for r in rows}
        if themes == {None}:
            problems.append("rows carry no theme stamp — specs/resize-polish.spec.mjs predates the theme field (stale checkout?)")
        elif themes != {theme}:
            problems.append(f"rows rendered with theme(s) {sorted(str(t) for t in themes)} instead of '{theme}'")
if problems:
    print(f"FATAL: fidelity collection guard failed for theme={theme}:")
    for p in problems: print(f"  - {p}")
    sys.exit(1)
print(f"  guard OK: {len(shots)} scenario PNG(s), {len(contacts)} contact sheet(s), every result row theme={theme}")
PY
done

echo "done: fidelity-$STEP ($(find "$HERE/output/fidelity-$STEP" -name '*.png' 2>/dev/null | wc -l) PNG(s) total) in test/e2e/shots/output/fidelity-$STEP/"
exit "$OVERALL_STATUS"
