#!/usr/bin/env bash
# One-time build for the ci-arm dev container. Idempotent: safe to re-run after a failure.
# Mirrors qa-example-content/dockerfiles/arm-local/setup-test-env.sh, minus the git clone
# (the source is already the editor-attached workspace).
set -euo pipefail

cd "${WORKSPACE_FOLDER:-/workspaces/positron}"

echo "==> [1/8] root npm ci"
[ -d node_modules ] && [ -n "$(ls -A node_modules 2>/dev/null)" ] || npm ci --fetch-timeout 120000

echo "==> [2/8] test/e2e npm ci"
[ -d test/e2e/node_modules ] && [ -n "$(ls -A test/e2e/node_modules 2>/dev/null)" ] || npm --prefix test/e2e ci

echo "==> [3/8] compile + electron (${POSITRON_CI_IMAGE_ARCH:-arm64})"
ELECTRON_ARCH="${POSITRON_CI_IMAGE_ARCH:-arm64}"
npm exec -- npm-run-all --max_old_space_size=4095 -lp compile "electron ${ELECTRON_ARCH}"

echo "==> [4/8] playwright install"
npm exec -- playwright install

echo "==> [5/8] chrome-sandbox perms"
SANDBOX=.build/electron/chrome-sandbox
if [ -f "$SANDBOX" ]; then
  sudo chown root "$SANDBOX"
  sudo chmod 4755 "$SANDBOX"
  stat "$SANDBOX"
else
  echo "WARNING: $SANDBOX not found; electron build may be incomplete"
fi

echo "==> [6/8] prelaunch"
npm run prelaunch

echo "==> [7/8] gulp node"
npm run gulp node

echo "==> [8/8] license"
if [ -n "${POSITRON_DEV_LICENSE:-}" ]; then
  LICENSE_DEST="/positron-license/pdol/target/debug/pdol_rsa"   # confirmed in Task 0 spike
  mkdir -p "$(dirname "$LICENSE_DEST")"
  printf "%s" "$POSITRON_DEV_LICENSE" > "$LICENSE_DEST"
  echo "license written to $LICENSE_DEST"
else
  echo "WARNING: POSITRON_DEV_LICENSE not set; build will be unlicensed"
fi

echo "==> post-create complete"
