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

# Confirm postgres reachable (service name 'postgres' on the compose network)
if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h postgres -U "${E2E_POSTGRES_USER:-testuser}" -d postgres; then
    echo "postgres reachable"
  else
    echo "WARNING: postgres not reachable"
  fi
fi
