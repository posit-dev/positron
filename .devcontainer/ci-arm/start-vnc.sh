#!/usr/bin/env bash
# Make the headless desktop (:10) viewable AND interactive, ready to connect any time. Runs a single
# TigerVNC server (Xvnc = the X display and the VNC server in one process), a window manager
# (fluxbox), and noVNC/websockify (so the desktop opens from a clickable http:// URL in a browser).
# Idempotent; called from post-start, launch-electron, and the "Positron CI: VNC" task.
# VNC password: "positron".
#
# Why Xvnc, not Xvfb + x11vnc: x11vnc polled a *separate* Xvfb and died with an "XIO error" whenever
# junk traffic on :5900 (VS Code's port probe, the Doctor's liveness checks) disrupted it — taking
# the whole desktop down. Xvnc is one integrated, network-hardened server: bad clients are just
# dropped, the display stays up. We also disable TigerVNC's connection blacklist below — on a
# localhost-only lab that probe churn would otherwise blacklist 127.0.0.1 and lock noVNC out.
set -euo pipefail
export DISPLAY="${DISPLAY:-:10}"
VNC_PASSWORD="positron"
GEOMETRY="2560x1440"
DEPTH="24"
PASSWD_FILE="$HOME/.vnc/passwd"

# --quiet (used when chained from post-start, which prints its own "ready" banner with the URL)
# suppresses the trailing "Desktop ready" block below so the URL isn't echoed twice. Standalone runs
# — the "Positron CI: VNC" task — print it.
QUIET=0
case "${1:-}" in -q|--quiet) QUIET=1 ;; esac

# Serialize: post-start, launch-electron, and the VNC task can fire concurrently. Without a lock two
# runs race to start the server. flock makes them queue; the later one finds it up and no-ops. The
# long-lived daemons below use 9>&- so they don't inherit the lock fd and deadlock the next run.
exec 9>/tmp/start-vnc.lock
flock 9

# Install TigerVNC + noVNC on first use (the CI image doesn't ship them). A network install at boot
# can transiently fail (slow mirror, update race), so retry a few times and keep a log under /tmp.
pkgs=()
command -v Xvnc       >/dev/null 2>&1 || pkgs+=(tigervnc-standalone-server tigervnc-common)
command -v websockify >/dev/null 2>&1 || pkgs+=(novnc websockify)
if [ "${#pkgs[@]}" -gt 0 ]; then
  echo "Installing ${pkgs[*]} (first run, ~once)…"
  for _ in 1 2 3; do
    { DEBIAN_FRONTEND=noninteractive apt-get update -qq \
      && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${pkgs[@]}"; } \
      >/tmp/vnc-install.log 2>&1 || true
    command -v Xvnc >/dev/null 2>&1 && command -v websockify >/dev/null 2>&1 && break
    sleep 2
  done
  { command -v Xvnc >/dev/null 2>&1 && command -v websockify >/dev/null 2>&1; } \
    || echo "WARNING: VNC tools failed to install after retries — see /tmp/vnc-install.log"
fi

# VNC password file (TigerVNC VncAuth). vncpasswd -f reads the password from stdin and writes the
# obfuscated form to stdout. Cheap to regenerate each run, so it's always correct. Guarded on
# vncpasswd existing: if the install above failed, calling it would exit 127 and (under set -e) abort
# the whole script before we reach the clearer "is Xvnc here?" failure path below.
if command -v vncpasswd >/dev/null 2>&1; then
  mkdir -p "$(dirname "$PASSWD_FILE")"
  printf '%s' "$VNC_PASSWORD" | vncpasswd -f > "$PASSWD_FILE" 2>/dev/null
  chmod 600 "$PASSWD_FILE"
fi

# Start Xvnc on :10 / RFB :5900 if it isn't already serving. Verify it actually binds :5900 (not just
# that a process exists) and retry. setsid + 9>&- so it survives the launching shell/task and doesn't
# hold the flock. -BlacklistThreshold is huge so localhost probe churn never locks out the real client.
vnc_up() { (exec 3<>/dev/tcp/127.0.0.1/5900) 2>/dev/null; }
if ! vnc_up; then
  vncserver -kill :10 >/dev/null 2>&1 || true
  for _ in 1 2 3; do
    # Kill any prior attempt and clear its X locks INSIDE the loop, so a retry can't leave two Xvnc
    # processes racing for display :10 / port :5900 if the previous one was slow to bind.
    pkill -x Xvnc 2>/dev/null || true
    rm -f /tmp/.X10-lock "/tmp/.X11-unix/X10" 2>/dev/null || true
    setsid Xvnc :10 -geometry "$GEOMETRY" -depth "$DEPTH" -rfbport 5900 \
      -SecurityTypes VncAuth -PasswordFile "$PASSWD_FILE" -AlwaysShared \
      -BlacklistThreshold 1000000 \
      >/tmp/xvnc.log 2>&1 </dev/null 9>&- &
    for _ in $(seq 1 8); do vnc_up && break; sleep 1; done
    vnc_up && break
  done
fi

# Wait until the display is actually responsive before starting the window manager.
for _ in $(seq 1 15); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done

# Window manager so windows are movable and the desktop is usable (right-click menu, drag).
if command -v fluxbox >/dev/null 2>&1 && ! pgrep -x fluxbox >/dev/null 2>&1; then
  setsid fluxbox >/tmp/fluxbox.log 2>&1 </dev/null 9>&- &
fi

# Browser-based VNC (noVNC) so the desktop opens from a clickable http URL. setsid + 9>&- as above.
# Verify it actually binds :6080 and retry, like Xvnc above: started bare in the background it can
# lose the race against Xvnc (proxy target :5900 not ready yet) and exit, leaving :6080 down with
# nothing to restart it until the next start-vnc.sh call — which is why noVNC sometimes showed down
# after the VNC task but came up once launching the desktop re-ran this.
novnc_up() { (exec 3<>/dev/tcp/127.0.0.1/6080) 2>/dev/null; }
if command -v websockify >/dev/null 2>&1 && ! novnc_up; then
  for _ in 1 2 3; do
    pkill -f "websockify.*6080" 2>/dev/null || true
    setsid websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 </dev/null 9>&- &
    for _ in $(seq 1 5); do novnc_up && break; sleep 1; done
    novnc_up && break
  done
fi

if [ "$QUIET" -eq 0 ]; then
  NOVNC_URL="http://localhost:6080/vnc.html?autoconnect=true&password=${VNC_PASSWORD}"
  echo "Desktop ready — open in your browser (Cmd-click):"
  echo "    ${NOVNC_URL}"
  echo "(or a native VNC viewer → vnc://localhost:5900, password ${VNC_PASSWORD})"
fi
