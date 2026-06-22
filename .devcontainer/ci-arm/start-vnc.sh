#!/usr/bin/env bash
# Make the headless display (:10) viewable, ready to connect any time. Starts a window manager
# (fluxbox), x11vnc (for native VNC viewers), and noVNC/websockify (so the desktop is a clickable
# http:// URL in a browser — no separate app needed). Idempotent; called from post-start and
# launch-electron. VNC password: "positron".
set -euo pipefail
export DISPLAY="${DISPLAY:-:10}"
VNC_PASSWORD="positron"

# Display server (post-start usually starts it; ensure it here too). Always wait until it's actually
# responsive before starting x11vnc — otherwise x11vnc loses the race at boot and exits unbound.
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  /usr/bin/Xvfb :10 -ac -screen 0 2560x1440x24 >/tmp/Xvfb.out 2>&1 &
fi
for _ in $(seq 1 15); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done

# Window manager so windows are movable and the desktop is usable (right-click for a menu).
if command -v fluxbox >/dev/null 2>&1 && ! pgrep -x fluxbox >/dev/null 2>&1; then
  fluxbox >/tmp/fluxbox.log 2>&1 &
fi

# VNC server for native viewers. macOS Screen Sharing requires a password, so we set one. Verify it
# actually binds :5900 (not just that a process exists) and retry — at boot it can exit before
# binding, which is why VNC sometimes shows down right after the container starts.
#
# Detach with setsid (like websockify below), NOT x11vnc's own -bg: when this script runs from the
# postStart hook / a task, the -bg child stays in the launching shell's session and gets reaped when
# that shell exits — x11vnc then dies seconds after start and VNC won't connect. setsid puts it in
# its own session so it survives. (-quiet dropped too, so /tmp/x11vnc.log keeps the exit reason.)
vnc_up() { (exec 3<>/dev/tcp/127.0.0.1/5900) 2>/dev/null; }
if ! vnc_up; then
  x11vnc -storepasswd "$VNC_PASSWORD" /tmp/.vncpw >/dev/null 2>&1
  for _ in 1 2 3; do
    pkill -x x11vnc 2>/dev/null || true
    setsid x11vnc -display "$DISPLAY" -forever -shared -rfbauth /tmp/.vncpw -rfbport 5900 >/tmp/x11vnc.log 2>&1 </dev/null &
    for _ in $(seq 1 5); do vnc_up && break; sleep 1; done
    vnc_up && break
  done
fi

# Browser-based VNC (noVNC) so the desktop opens from a clickable http URL. Install on first use
# (the CI image doesn't ship it). setsid so it survives the launching shell/task exiting.
if ! command -v websockify >/dev/null 2>&1; then
  echo "Installing noVNC (first run, ~once)…"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq novnc websockify >/dev/null 2>&1 || true
fi
if command -v websockify >/dev/null 2>&1 && ! pgrep -f "websockify.*6080" >/dev/null 2>&1; then
  setsid websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 </dev/null &
fi

NOVNC_URL="http://localhost:6080/vnc.html?autoconnect=true&password=${VNC_PASSWORD}"
echo "Desktop ready — open in your browser (Cmd-click):"
echo "    ${NOVNC_URL}"
echo "(or a native VNC viewer → vnc://localhost:5900, password ${VNC_PASSWORD})"
