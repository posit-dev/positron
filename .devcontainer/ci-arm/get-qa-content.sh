#!/usr/bin/env bash
# Provision the e2e test content — the files the e2e tests open — so it's available for manual
# repro without running a test first. Re-run any time to refresh it from the current checkout.
#
# Mirrors the e2e global-setup provisioning (test/e2e/infra/test-runner/utils.ts): copy the
# in-repo test/e2e/test-files directory to the working path the tests use, then git-init a
# baseline so teardown can reset it. Paths follow the same defaults, so this and the tests agree:
#   source:       <repo>/test/e2e/test-files
#   working copy: ${POSITRON_TEST_DATA_PATH:-$TMPDIR/vscsmoke}/test-files
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO_ROOT/test/e2e/test-files"
TMP="${TMPDIR:-/tmp}"; TMP="${TMP%/}"
DEST="${POSITRON_TEST_DATA_PATH:-$TMP/vscsmoke}/test-files"

if [ ! -d "$SRC" ]; then
  # allow-any-unicode-next-line
  echo "  ✗ test files not found at $SRC"
  exit 1
fi

echo "Provisioning test files from $SRC…"

# Copy the in-repo content -> the working path the tests open.
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST"

# git-init a baseline so teardown (git reset --hard + git clean -fd) can restore it between tests.
git -C "$DEST" init -q
git -C "$DEST" add -A
git -C "$DEST" -c user.email=e2e@posit.co -c user.name=e2e -c commit.gpgsign=false commit -q -m "test-files baseline"

# Convenience symlink in $HOME so it's easy to find from Positron's "Open Folder" dialog,
# which defaults to the home dir. The real copy stays at $DEST (the test path) so manual
# repro matches what the e2e tests open.
LINK="$HOME/test-files"
ln -sfn "$DEST" "$LINK"

echo "  ✓ ready at $DEST"
echo "  ✓ linked at $LINK  (open this from Positron's Open Folder dialog)"
echo ""
echo "Browse it for manual repro — e.g. $LINK/workspaces"
