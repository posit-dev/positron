#!/usr/bin/env bash
# Launch the Positron Electron (desktop) app on the headless Xvfb display and expose it over VNC.
#
# To see it from your Mac: make sure port 5900 is forwarded (it's in devcontainer.json), then
# connect a VNC viewer to localhost:5900 — on macOS, Finder → Cmd+K → vnc://localhost:5900
# (built-in Screen Sharing, no install needed). VNC password: "positron"
# (macOS Screen Sharing requires a password, so we set one rather than running open).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export DISPLAY="${DISPLAY:-:10}"
VNC_PASSWORD="positron"

if ! pgrep -x x11vnc >/dev/null 2>&1; then
  x11vnc -storepasswd "$VNC_PASSWORD" /tmp/.vncpw >/dev/null 2>&1
  x11vnc -display "$DISPLAY" -forever -shared -rfbauth /tmp/.vncpw -rfbport 5900 -bg -quiet >/tmp/x11vnc.log 2>&1
  echo "Started x11vnc on :5900 (display $DISPLAY)."
else
  echo "x11vnc already running on :5900."
fi

echo "View it: VNC to localhost:5900 — password: ${VNC_PASSWORD}  (macOS: Finder → Cmd+K → vnc://localhost:5900)"
cd "$ROOT"
exec ./scripts/code.sh --no-sandbox
