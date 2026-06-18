#!/usr/bin/env bash
# Report whether the build is current and print actionable guidance. Read-only — changes nothing.
# Run automatically on container start (post-start.sh) and available as a manual task.
set -uo pipefail
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$WS/.build/.ci-arm-state"
issues=0
note() { echo "  ⚠ $1"; issues=$((issues + 1)); }
sha() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "missing"; }

echo "=== ci-arm build doctor ==="

[ -f "$STATE/complete" ] || \
  note "Cold build never completed → run the 'Full rebuild (post-create)' task."

[ -d "$WS/out" ] || \
  note "No compiled output (out/) → start 'Watch (incremental build)', or run 'Compile (one-shot)'."

[ -e "$WS/.build/electron" ] || \
  note "Electron not set up (.build/electron) → run the 'Full rebuild (post-create)' task."

[ "$(sha "$WS/package-lock.json")" = "$(cat "$STATE/deps.sha" 2>/dev/null)" ] || \
  note "Root dependencies changed since last install → run 'Reinstall deps (npm ci)'."

[ "$(sha "$WS/test/e2e/package-lock.json")" = "$(cat "$STATE/e2e-deps.sha" 2>/dev/null)" ] || \
  note "test/e2e dependencies changed → run 'Reinstall e2e deps'."

if [ "$issues" -eq 0 ]; then
  echo "  ✓ build looks current — incremental watch is all you need."
fi
exit 0
