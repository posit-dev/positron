#!/usr/bin/env bash
# Record the state of a successful build so build-doctor.sh can detect drift later.
# Stored under .build/ so it persists with the build and is wiped on a full rebuild.
set -euo pipefail
WS="${WORKSPACE_FOLDER:-/workspaces/positron}"
STATE="$WS/.build/.ci-arm-state"
mkdir -p "$STATE"
sha() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "missing"; }
sha "$WS/package-lock.json"          > "$STATE/deps.sha"
sha "$WS/test/e2e/package-lock.json" > "$STATE/e2e-deps.sha"
date -u +%FT%TZ > "$STATE/complete"
echo "build state recorded in $STATE"
