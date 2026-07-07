#!/usr/bin/env bash
# Stop + remove every container this harness started (idempotent — safe to run
# before a fresh setup, or when nothing is up). Everything the harness starts
# is named shots-* (backends, BFF; seed/capture/diff containers are one-shot
# `docker run --rm`), so a single name-pattern sweep catches leftovers from an
# interrupted run too.
set -uo pipefail
ids="$(docker ps -aq --filter 'name=^shots-' 2>/dev/null || true)"
if [ -n "$ids" ]; then
  # shellcheck disable=SC2086
  docker rm -f $ids >/dev/null 2>&1 || true
fi
exit 0
