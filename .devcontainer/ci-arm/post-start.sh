#!/usr/bin/env bash
# Per-start: ensure the desktop (display + VNC) and DB are ready. Idempotent.
set -euo pipefail

# The display itself is created by Xvnc in start-vnc.sh (called below) — Xvnc IS the X server now,
# so there's no separate Xvfb to start here. We just export DISPLAY for the steps in between.
export DISPLAY=:10

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

# Bring up the desktop (Xvnc display + window manager + noVNC) so you can connect any time without
# launching anything first.
"$(dirname "$0")/start-vnc.sh" --quiet || true

# Advisory: flag wrong-OS native binaries (checkout also built natively?) instead of a silent hang.
"$(dirname "$0")/check-native-arch.sh" || true

# Completion notice. We deliberately do NOT render the Doctor here: a one-shot render looks
# identical to the live Doctor panel, so people press a key to "refresh" and this postStart terminal
# closes — which feels broken. Just confirm readiness and point at the real (interactive) Doctor.
cat <<'MSG'

  ------------------------------------------------------------
    🎉  Success! Your CI Lab is set up and ready for use!
  ------------------------------------------------------------
MSG

# Only after a fresh cold build (flag set by post-create): the editor attached before node_modules
# existed, so a one-time reload restarts the TS server / Playwright against the installed deps.
if [ -f /tmp/.ci-arm-fresh-build ]; then
  rm -f /tmp/.ci-arm-fresh-build
  cat <<'MSG'

  ▸ First-time setup — run "Developer: Reload Window" once:
      the editor started before deps finished installing, so reloading clears the editor's
      unresolved-import errors (most visible on the e2e tests) and restores the run/debug icons
      in the test gutter.
MSG
fi

cat <<'MSG'

  ▸ Start the Doctor to see services, ports, and build status:
      the "Doctor" button in the status bar
      (or Command Palette → "Tasks: Run Task" → "Positron CI: Doctor")

MSG
