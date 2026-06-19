#!/usr/bin/env bash
# Launch the Positron Electron (desktop) app on the headless display and expose it for viewing.
# Prints a clickable noVNC URL (http://localhost:6080/...) to open the desktop in a browser; a
# native VNC viewer at vnc://localhost:5900 (password "positron") also works.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export DISPLAY="${DISPLAY:-:10}"

cd "$ROOT"
# The desktop app needs the compiled main entry. If post-create is still building, fail friendly.
if [ ! -f "$ROOT/out/main.js" ]; then
  echo "Positron isn't built yet — out/main.js is missing (the cold build / post-create may still be running)."
  echo "Click the 'Doctor' button (or run 'Positron CI: Check build status'), wait until it reports the"
  echo "build is current, then try again."
  exit 1
fi

# Ensure the display is viewable (window manager + VNC + noVNC).
"$HERE/start-vnc.sh" >/dev/null

# code.sh runs Electron in the foreground (streams logs, never returns). Launch it detached with
# its logs sent to a file so they don't bury the URL; setsid keeps it alive after this task ends.
setsid ./scripts/code.sh --no-sandbox >/tmp/positron-electron.log 2>&1 </dev/null &
sleep 3

echo ""
echo "Positron Electron is starting (logs: /tmp/positron-electron.log)."
echo "Open the desktop in your browser — Cmd-click (the window appears in ~15s as it boots):"
echo ""
echo "    http://localhost:6080/vnc.html?autoconnect=true&password=positron"
echo ""
