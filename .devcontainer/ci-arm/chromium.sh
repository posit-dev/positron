#!/usr/bin/env bash
# Resolve Playwright's bundled Chromium (the same browser the e2e-chromium tests use) and exec it
# with whatever args the debugger passes. Used as runtimeExecutable for the "Positron CI: Debug app
# (web)" launch config so the config doesn't hardcode the volatile chromium-<rev> path, which
# changes every time `playwright install` pulls a new build.
set -euo pipefail
# `|| true`: under `set -euo pipefail` a non-matching glob makes `ls` fail and pipefail would
# abort the script here, before the guard below — losing the helpful message. Let it fall through.
CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "chromium.sh: no Playwright Chromium under ~/.cache/ms-playwright — run 'npm exec -- playwright install chromium'." >&2
  exit 1
fi
exec "$CHROME" "$@"
