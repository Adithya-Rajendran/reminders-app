#!/usr/bin/env bash
# Stop anything this harness started (idempotent). Safe to run before a fresh
# setup to free ports 5232/8081/8080.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/.state"
for name in bff radicale wsgidav; do
  pidf="$STATE/$name.pid"
  if [ -f "$pidf" ]; then
    pid="$(cat "$pidf" 2>/dev/null || true)"
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
    rm -f "$pidf"
  fi
done
# Belt-and-braces: free the ports by pattern in case PIDs drifted.
pkill -f 'radicale --config' 2>/dev/null || true
pkill -f 'wsgidav --config' 2>/dev/null || true
exit 0
