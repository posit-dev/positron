#!/usr/bin/env bash
# Reinstall npm deps after a pull/branch-switch changes a package-lock.json, then re-stamp the
# build state so build-doctor.sh stops flagging drift. Backs both the "Reinstall deps" and
# "Reinstall e2e deps" workspace tasks, and the CLI-only flow in README.md, so the logic lives
# in one place instead of three.
#
# Usage: reinstall-deps.sh [root|e2e|all]   (default: all)
#   root  npm ci at the repo root            (after root package-lock.json changes)
#   e2e   npm ci in test/e2e                 (after test/e2e/package-lock.json changes)
#   all   both
set -euo pipefail
WHAT="${1:-all}"
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$WS"

case "$WHAT" in
  root) npm ci --fetch-timeout 120000 ;;
  e2e)  npm --prefix test/e2e ci --fetch-timeout 120000 ;;
  all)  npm ci --fetch-timeout 120000
        npm --prefix test/e2e ci --fetch-timeout 120000 ;;
  *)    echo "reinstall-deps.sh: unknown target '$WHAT' (use root|e2e|all)" >&2; exit 2 ;;
esac

"$(dirname "$0")/mark-build-state.sh" "$WHAT"
