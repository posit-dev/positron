#!/usr/bin/env bash
# Health check: is the build current, and what's up? Read-only — changes nothing.
# Run automatically on container start (post-start.sh) and available as a manual task.
set -uo pipefail
WS="${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"
STATE="$WS/.build/.ci-arm-state"
attention=0
sha() { [ -f "$1" ] && sha256sum "$1" | awk '{print $1}' || echo "missing"; }

# TCP probe — no extra tools needed (the CI image lacks pg_isready/ss in places). tcp <host> <port>
tcp() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

echo "=== ci-arm doctor ==="

# --- Build state ---------------------------------------------------------------------------------
echo "build:"
build_issues=0
bnote() { echo "  ⚠ $1"; build_issues=$((build_issues + 1)); attention=$((attention + 1)); }

[ -f "$STATE/complete" ] || \
  bnote "Cold build never completed → run 'Full rebuild (post-create)'."
[ -d "$WS/out" ] || \
  bnote "No compiled output (out/) → start the watcher ('npm run watch'), or run 'Full rebuild (post-create)'."
[ -e "$WS/.build/electron" ] || \
  bnote "Electron not set up (.build/electron) → run 'Full rebuild (post-create)'."
[ "$(sha "$WS/package-lock.json")" = "$(cat "$STATE/deps.sha" 2>/dev/null)" ] || \
  bnote "Root dependencies changed since last install → run 'Reinstall deps (npm ci)'."
[ "$(sha "$WS/test/e2e/package-lock.json")" = "$(cat "$STATE/e2e-deps.sha" 2>/dev/null)" ] || \
  bnote "test/e2e dependencies changed → run 'Full rebuild (post-create)'."

[ "$build_issues" -eq 0 ] && echo "  ✓ build looks current — incremental watch is all you need."

# --- Services (post-start brings these up; down = a problem) --------------------------------------
echo "services:"
svc() { # svc "label" <up:0/1>
  if [ "$2" -eq 0 ]; then echo "  ✓ $1"; else echo "  ⚠ $1 — DOWN"; attention=$((attention + 1)); fi
}
pgrep -x Xvfb >/dev/null 2>&1;     svc "display (Xvfb :10)"        "$?"
tcp 127.0.0.1 5900;                svc "VNC (x11vnc :5900)"        "$?"
tcp 127.0.0.1 6080;                svc "noVNC (websockify :6080)"  "$?"
tcp postgres 5432;                 svc "postgres (postgres:5432)"  "$?"

# --- On demand (you start these; "not running" is normal) -----------------------------------------
echo "on demand:"
opt() { # opt "label" <running:0/1> [hint-when-running]
  if [ "$2" -eq 0 ]; then echo "  ● $1${3:+ — $3}"; else echo "  ○ $1 — not running"; fi
}
tcp 127.0.0.1 8080
opt "Positron server (:8080)" "$?" "http://localhost:8080/?tkn=dev-token"
pgrep -f "user-data-dir=/tmp/positron-dev-data" >/dev/null 2>&1
opt "Desktop app (Electron)" "$?" "view at http://localhost:6080/vnc.html?autoconnect=true&password=positron"
tcp 127.0.0.1 9323
opt "Playwright report (:9323)" "$?" "http://localhost:9323"

# --- Footer ---------------------------------------------------------------------------------------
if [ "$attention" -ne 0 ]; then
  echo "→ $attention item(s) need attention (see ⚠ above)."
fi
exit 0
