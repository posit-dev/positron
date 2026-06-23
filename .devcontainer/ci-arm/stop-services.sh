#!/usr/bin/env bash
# Stop the on-demand Positron processes (server, desktop, Playwright report) that this dev container
# starts detached. Leaves the core services (Xvnc, noVNC, postgres) up — those are the
# always-on baseline and cheap when idle. Idempotent: stopping something already stopped is fine.
set -uo pipefail

stop() { # stop <label> <pgrep -f pattern>
  local pids
  pids=$(pgrep -f "$2" 2>/dev/null || true)
  if [ -z "$pids" ]; then
    echo "  – $1 — not running"
    return
  fi
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids=$(pgrep -f "$2" 2>/dev/null || true)
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  echo "  ✓ $1 — stopped"
}

echo "Stopping on-demand Positron processes…"
stop "Positron server (:8080)"   "out/server-main.js.*--port 8080"
stop "Desktop app (Electron)"    "user-data-dir=/tmp/positron-dev-data"
stop "Playwright report (:9323)" "playwright.*show-report"

# Clear any "failed to start" markers — stopping resets intent (the Doctor shows them otherwise).
rm -f /tmp/positron-server.err /tmp/positron-electron.err

echo "Core services (Xvnc desktop, noVNC, postgres) left running. Run the Doctor to confirm."
echo
echo "  To disconnect from the container:"
echo "  Click the remote indicator (bottom-left status bar) → Reopen Folder Locally"
echo "  Container + volumes stay intact; next open skips the cold build."
exit 0
