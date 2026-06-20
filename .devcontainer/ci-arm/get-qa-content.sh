#!/usr/bin/env bash
# Fetch or refresh qa-example-content — the repo the e2e tests open — so it's available for manual
# repro without running a test first. Re-run any time to cycle it to the latest of the branch.
#
# Mirrors the e2e global-setup clone (test/e2e/infra/test-runner/utils.ts): a shallow cache, copied
# to the working path the tests use. Paths follow the same defaults, so this and the tests agree:
#   cache:        $TMPDIR/qa-example-content-cache
#   working copy: ${POSITRON_TEST_DATA_PATH:-$TMPDIR/vscsmoke}/qa-example-content
set -euo pipefail
REPO="https://github.com/posit-dev/qa-example-content.git"
BRANCH="${QA_REPO:-main}"
TMP="${TMPDIR:-/tmp}"; TMP="${TMP%/}"
CACHE="$TMP/qa-example-content-cache"
DEST="${POSITRON_TEST_DATA_PATH:-$TMP/vscsmoke}/qa-example-content"

echo "Fetching qa-example-content (branch $BRANCH)…"
if [ -d "$CACHE/.git" ]; then
  if git -C "$CACHE" fetch --depth=1 origin "$BRANCH" -q 2>/dev/null \
     && git -C "$CACHE" reset --hard FETCH_HEAD -q 2>/dev/null \
     && git -C "$CACHE" clean -fdq 2>/dev/null; then
    echo "  ✓ cache updated to latest origin/$BRANCH"
  else
    echo "  ! couldn't update the cache (offline?) — using the existing cached copy"
  fi
else
  rm -rf "$CACHE"
  if ! git clone --depth=1 --branch "$BRANCH" "$REPO" "$CACHE" -q; then
    # allow-any-unicode-next-line
    echo "  ✗ clone failed (offline, or branch '$BRANCH' not found)"
    exit 1
  fi
  echo "  ✓ cloned fresh"
fi

# Copy cache -> the working path the tests open (include .git: teardown git-resets this copy).
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$CACHE/." "$DEST"

# Convenience symlink in $HOME so it's easy to find from Positron's "Open Folder" dialog,
# which defaults to the home dir. The real copy stays at $DEST (the test path) so manual
# repro matches what the e2e tests open.
LINK="$HOME/qa-example-content"
ln -sfn "$DEST" "$LINK"

commit="$(git -C "$DEST" rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "  ✓ ready at $DEST  (branch $BRANCH @ $commit)"
echo "  ✓ linked at $LINK  (open this from Positron's Open Folder dialog)"
echo ""
echo "Browse it for manual repro — e.g. $LINK/workspaces"
