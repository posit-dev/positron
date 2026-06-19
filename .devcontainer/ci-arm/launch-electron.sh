#!/usr/bin/env bash
# Launch the Positron Electron (desktop) app on the headless Xvfb display and expose it over VNC.
#
# To see it from your Mac: make sure port 5900 is forwarded (it's in devcontainer.json), then
# connect a VNC viewer to localhost:5900 — on macOS, Finder → Cmd+K → vnc://localhost:5900
# (built-in Screen Sharing, no install needed). VNC password: "positron"
# (macOS Screen Sharing requires a password, so we set one rather than running open).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export DISPLAY="${DISPLAY:-:10}"

# Ensure the display is viewable (window manager + VNC + noVNC), and print the connect URL.
"$HERE/start-vnc.sh"
cd "$ROOT"
# code.sh launches the Electron app and returns (it runs detached).
./scripts/code.sh --no-sandbox || true
echo ""
echo "Positron desktop launched. View it (Cmd-click):"
echo "    http://localhost:6080/vnc.html?autoconnect=true&password=positron"
