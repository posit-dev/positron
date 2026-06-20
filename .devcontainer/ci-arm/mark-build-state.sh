#!/usr/bin/env bash
# Record the state of a successful build so build-doctor.sh can detect drift later.
# Stored under .build/ so it persists with the build and is wiped on a full rebuild.
#
# Usage: mark-build-state.sh [root|e2e|all]   (default: all)
#   root  record only the root deps hash      (after "Reinstall deps" — root npm ci only)
#   e2e   record only the test/e2e deps hash   (after "Reinstall e2e deps")
#   all   record both                          (after a full cold build / Rebuild)
# Recording only the half you actually reinstalled keeps the Doctor honest: e.g. "Reinstall deps"
# must not clear the e2e-deps drift warning when it never touched test/e2e. Every mode re-stamps the
# completion marker so the Doctor redraws and shows a fresh "current" age.
set -euo pipefail
WHAT="${1:-all}"
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$WS/.build/.ci-arm-state"
mkdir -p "$STATE"
sha() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "missing"; }
case "$WHAT" in
  root) sha "$WS/package-lock.json"          > "$STATE/deps.sha" ;;
  e2e)  sha "$WS/test/e2e/package-lock.json" > "$STATE/e2e-deps.sha" ;;
  all)  sha "$WS/package-lock.json"          > "$STATE/deps.sha"
        sha "$WS/test/e2e/package-lock.json" > "$STATE/e2e-deps.sha" ;;
  *)    echo "mark-build-state.sh: unknown target '$WHAT' (use root|e2e|all)" >&2; exit 2 ;;
esac
date -u +%FT%TZ > "$STATE/complete"
echo "build state recorded ($WHAT) in $STATE"
