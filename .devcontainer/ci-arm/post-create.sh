#!/usr/bin/env bash
# One-time build for the ci-arm dev container. Idempotent: safe to re-run after a failure.
# Mirrors docker/environments/arm-local/setup-test-env.sh, minus the git clone
# (the source is already the editor-attached workspace).
set -euo pipefail

cd "${WORKSPACE_FOLDER:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "==> [1/8] root deps"
# fast-install.ts hashes package.json/package-lock.json/.npmrc across every dir in
# build/npm/dirs.ts (root plus each extension), so it catches a new/changed extension
# package.json even when the root package-lock.json itself didn't change -- unlike a plain
# non-empty check or a root-lockfile-only sha compare, both of which would skip the install
# and leave a stale node_modules a volume carried over from before that extension existed.
node build/npm/fast-install.ts

echo "==> [2/8] test/e2e npm ci"
[ "$(sha256sum test/e2e/package-lock.json | cut -d' ' -f1)" = "$(cat .build/.ci-arm-state/e2e-deps.sha 2>/dev/null)" ] || npm --prefix test/e2e ci

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
LICENSE_DEST="/positron-license/pdol/target/debug/pdol_rsa"   # confirmed in Task 0 spike
LICENSE_SRC="$(cd "$(dirname "$0")" && pwd)/license.txt"
if [ -f "$LICENSE_SRC" ]; then
  # Local path: PEM key file dropped in the (bind-mounted) workspace; gitignored.
  mkdir -p "$(dirname "$LICENSE_DEST")"
  cp "$LICENSE_SRC" "$LICENSE_DEST"
  chmod 600 "$LICENSE_DEST"  # private key - not world-readable, even in this privileged container
  echo "license installed from $LICENSE_SRC ($(wc -c < "$LICENSE_DEST") bytes)"
elif [ -n "${POSITRON_DEV_LICENSE:-}" ]; then
  # CI path: raw multi-line PEM injected as a real env var (e.g. GitHub secret).
  mkdir -p "$(dirname "$LICENSE_DEST")"
  printf '%s' "$POSITRON_DEV_LICENSE" > "$LICENSE_DEST"
  chmod 600 "$LICENSE_DEST"  # private key - not world-readable, even in this privileged container
  echo "license written to $LICENSE_DEST (from POSITRON_DEV_LICENSE env)"
else
  echo "WARNING: no license (add .devcontainer/ci-arm/license.txt); build will be unlicensed"
fi

echo "==> recording build state"
"$(dirname "$0")/mark-build-state.sh"

# Flag a fresh cold build so the next post-start prompts a one-time "Reload Window" — the editor
# attached while node_modules was still installing, so the TS server / Playwright need a restart to
# pick them up. post-start consumes (deletes) this, so the prompt shows once per build, not per open.
touch /tmp/.ci-arm-fresh-build

echo "==> post-create complete"
