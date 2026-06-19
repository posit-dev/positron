#!/usr/bin/env bash
# Make the headless display (:10) viewable over VNC, ready to connect any time.
# Starts a lightweight window manager (fluxbox) + x11vnc with a password. Idempotent — called
# from post-start (so VNC is always on) and from launch-electron. Connect with a VNC viewer to
# localhost:5900, password "positron" (macOS: Finder → Cmd+K → vnc://localhost:5900).
set -euo pipefail
export DISPLAY="${DISPLAY:-:10}"
VNC_PASSWORD="positron"

# Display server (post-start usually starts it; ensure it here too).
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  /usr/bin/Xvfb :10 -ac -screen 0 2560x1440x24 >/tmp/Xvfb.out 2>&1 &
  for _ in $(seq 1 10); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
fi

# Window manager so windows are movable and the desktop is usable (right-click for a menu).
if command -v fluxbox >/dev/null 2>&1 && ! pgrep -x fluxbox >/dev/null 2>&1; then
  fluxbox >/tmp/fluxbox.log 2>&1 &
fi

# VNC server. macOS Screen Sharing requires a password, so we set one.
if ! pgrep -x x11vnc >/dev/null 2>&1; then
  x11vnc -storepasswd "$VNC_PASSWORD" /tmp/.vncpw >/dev/null 2>&1
  x11vnc -display "$DISPLAY" -forever -shared -rfbauth /tmp/.vncpw -rfbport 5900 -bg -quiet >/tmp/x11vnc.log 2>&1
fi

echo "VNC ready → vnc://localhost:5900  (password: ${VNC_PASSWORD})"
