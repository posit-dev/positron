#!/usr/bin/env bash
# Per-start: ensure the display server and DB are ready. Idempotent.
set -euo pipefail

export DISPLAY=:10
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  /usr/bin/Xvfb :10 -ac -screen 0 2560x1440x24 >/tmp/Xvfb.out 2>&1 &
fi
for _ in $(seq 1 10); do
  if xdpyinfo >/dev/null 2>&1; then
    echo "Xvfb ready on :10"
    break
  fi
  sleep 1
done

# Persist DISPLAY for interactive shells
grep -q 'export DISPLAY=:10' ~/.bashrc 2>/dev/null || echo 'export DISPLAY=:10' >> ~/.bashrc

# Web tests that self-start a server (e.g. e2e-chromium) run scripts/code-server.js, which finds
# the license issuer at <repo-parent>/positron-license. The CI image ships it at /positron-license
# (CI moves it next to the repo); we symlink it where code-server.js expects so the self-started
# server gets licensed instead of hanging.
WS="$(cd "$(dirname "$0")/../.." && pwd)"
LICENSE_SIBLING="$(dirname "$WS")/positron-license"
if [ ! -e "$LICENSE_SIBLING" ] && [ -d /positron-license ]; then
  ln -s /positron-license "$LICENSE_SIBLING" && echo "linked $LICENSE_SIBLING -> /positron-license"
fi

# Confirm postgres reachable. The CI image lacks pg_isready, so fall back to a TCP check.
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h postgres -U "${E2E_POSTGRES_USER:-testuser}" -d postgres && echo "postgres reachable" || echo "WARNING: postgres not reachable"
elif timeout 5 bash -c 'echo > /dev/tcp/postgres/5432' 2>/dev/null; then
  echo "postgres reachable (tcp)"
else
  echo "WARNING: postgres not reachable"
fi

# Make the headless display viewable over VNC right away (window manager + x11vnc), so you can
# connect any time without launching anything first.
"$(dirname "$0")/start-vnc.sh" || true

# Report whether the build is current and what (if anything) needs rebuilding.
"$(dirname "$0")/build-doctor.sh" || true
