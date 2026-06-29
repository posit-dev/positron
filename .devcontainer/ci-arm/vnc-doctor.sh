#!/usr/bin/env bash
# Gather VNC-stack evidence in one shot, for debugging "the VNC viewer keeps shutting down".
# Runs inside the dev container (the `test` service). The output is meant to be pasted into a
# bug report: it shows which layer of the pipeline dropped (Xvnc -> websockify -> noVNC) and the
# usual culprits (a process exited, a port isn't bound, or the kernel OOM-killed something).
set -uo pipefail

probe() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && echo "up" || echo "DOWN"; }

echo "=== processes (want all three present) ==="
for p in Xvnc fluxbox; do
  if pgrep -x "$p" >/dev/null 2>&1; then echo "  $p: running"; else echo "  $p: NOT running"; fi
done
if pgrep -f "websockify.*6080" >/dev/null 2>&1; then echo "  websockify: running"; else echo "  websockify: NOT running"; fi
command -v websockify >/dev/null 2>&1 || echo "  !! websockify not installed — the noVNC apt install (start-vnc.sh) likely failed"

echo
echo "=== ports ==="
echo "  :5900 (Xvnc)    $(probe 5900)"
echo "  :6080 (noVNC)   $(probe 6080)"

echo
echo "=== memory (OOM on a low-RAM Docker Desktop is the most common cause) ==="
free -m 2>/dev/null || echo "  (free unavailable)"

echo
echo "=== recent kernel OOM / kill messages ==="
dmesg 2>/dev/null | grep -iE 'oom|killed process' | tail -5 || echo "  (no OOM lines, or dmesg unavailable)"

for f in /tmp/xvnc.log /tmp/vnc-install.log /tmp/websockify.log /tmp/fluxbox.log; do
  echo
  echo "=== tail $f ==="
  if [ -f "$f" ]; then tail -25 "$f"; else echo "  (missing)"; fi
done
