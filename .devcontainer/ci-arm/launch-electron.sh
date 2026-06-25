#!/usr/bin/env bash
# Launch the Positron Electron (desktop) app on the headless display and expose it for viewing.
# Prints a clickable noVNC URL (http://localhost:6080/...) to open the desktop in a browser; a
# native VNC viewer at vnc://localhost:5900 (password "positron") also works.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export DISPLAY="${DISPLAY:-:10}"

cd "$ROOT"
ERR=/tmp/positron-electron.err  # the Doctor reads this to flag a failed launch; cleared on success
fail() { echo "$1" >"$ERR"; echo "$1"; exit 1; }

# The desktop app needs the compiled main entry. If post-create is still building, fail friendly.
if [ ! -f "$ROOT/out/main.js" ]; then
  echo "Positron isn't built yet — out/main.js is missing (the cold build / post-create may still be running)."
  echo "Click the 'Doctor' button (or run 'Positron CI: Doctor'), wait until it reports the"
  echo "build is current, then try again."
  fail "not built — run 'Positron CI: Rebuild'"
fi

# Ensure the display is viewable (window manager + VNC + noVNC).
"$HERE/start-vnc.sh" >/dev/null

# Use an isolated user-data-dir and clear any prior instance/lock first. Otherwise a leftover or
# stuck instance triggers Electron's "another instance is running" lock and the new window paints
# blank/white. This makes re-clicking Launch a clean restart.
USER_DATA=/tmp/positron-dev-data
pkill -f "user-data-dir=$USER_DATA" 2>/dev/null || true
sleep 1
pkill -9 -f "user-data-dir=$USER_DATA" 2>/dev/null || true
rm -f "$USER_DATA/SingletonLock" 2>/dev/null || true

# code.sh runs Electron in the foreground (streams logs, never returns). Launch it detached with
# logs to a file so they don't bury the URL; setsid keeps it alive after this task ends. The
# software-GL flags (same set the e2e runner uses) let it render on the headless display (no GPU).
#
# VSCODE_SKIP_PRELAUNCH=1: the cold build / Rebuild already ran prelaunch (compile + electron +
# built-in extensions). Re-running it on every launch only slows startup and briefly re-extracts
# .build/electron — which made the Doctor flash a false "Electron not set up". Skip it here.
VSCODE_SKIP_PRELAUNCH=1 setsid ./scripts/code.sh --no-sandbox --user-data-dir="$USER_DATA" \
  --disable-dev-shm-usage \
  --use-gl=swiftshader \
  --enable-unsafe-swiftshader \
  --disable-gpu-compositing \
  >/tmp/positron-electron.log 2>&1 </dev/null &
sleep 3

# If Electron died on launch (e.g. a render/runtime error), flag it for the Doctor; else clear.
if ! pgrep -f "user-data-dir=$USER_DATA" >/dev/null 2>&1; then
  fail "exited on launch — check /tmp/positron-electron.log"
fi
rm -f "$ERR"

echo ""
echo "Positron Electron is starting (logs: /tmp/positron-electron.log)."
echo "Open the desktop in your browser — Cmd-click (the window appears in ~15s as it boots):"
echo ""
echo "    http://localhost:6080/vnc.html?autoconnect=true&password=positron"
echo ""
