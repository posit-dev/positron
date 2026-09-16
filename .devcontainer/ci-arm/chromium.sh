#!/usr/bin/env bash
# Resolve Playwright's bundled Chromium (the same browser the e2e-chromium tests use) and exec it
# with whatever args the debugger passes. Used as runtimeExecutable for the "Positron CI: Debug app
# (web)" launch config so the config doesn't hardcode the volatile chromium-<rev> path, which
# changes every time `playwright install` pulls a new build.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Ask Playwright itself: the directory inside chromium-<rev> is platform-specific
# (chrome-linux-arm64, chrome-linux64, ...) and has changed across releases, so a glob over one
# layout silently stops matching after an upgrade.
CHROME="$(cd "$REPO_ROOT" && node -e 'process.stdout.write(require("playwright").chromium.executablePath())' 2>/dev/null || true)"
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  echo "chromium.sh: no Playwright Chromium under ~/.cache/ms-playwright — run 'npm exec -- playwright install chromium'." >&2
  exit 1
fi
exec "$CHROME" "$@"
