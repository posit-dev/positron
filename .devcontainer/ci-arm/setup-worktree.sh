#!/usr/bin/env bash
# Create (or reuse) a dedicated git worktree for CI dev-container work, so container (Linux) builds
# never share a checkout with native (host) builds. See README "How storage works". Run on the HOST
# from a FULL Positron clone (this script lives at <clone>/.devcontainer/ci-arm/).
#
# Usage: ./.devcontainer/ci-arm/setup-worktree.sh [dest-path] [branch]
#   dest-path  default: <clone>-ci      (or $POSITRON_CI_WORKTREE)
#   branch     default: a new branch ci-container-<date> off current HEAD
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(cd "$HERE/../.." && pwd)"
cd "$MAIN"

# Must be a full clone (the compile needs history) and the main clone, not a worktree.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  echo "This is a shallow clone; the build needs full history. Re-clone at full depth." >&2
  exit 1
fi
if [ -f "$MAIN/.git" ]; then   # a linked worktree has a .git FILE; the main clone has a .git DIR
  echo "Run this from your main clone, not from a worktree." >&2
  exit 1
fi

DEST="${1:-${POSITRON_CI_WORKTREE:-${MAIN}-ci}}"
BRANCH="${2:-}"

# Normalize DEST to a real absolute path so the "already exists" check matches the paths git stores
# (git resolves symlinks; e.g. on macOS /var -> /private/var, which would otherwise never match).
if dest_parent="$(cd "$(dirname "$DEST")" 2>/dev/null && pwd -P)"; then
  DEST="$dest_parent/$(basename "$DEST")"
fi

if git worktree list --porcelain | grep -qxF "worktree $DEST"; then
  echo "Worktree already exists at: $DEST  (reusing)"
else
  if [ -z "$BRANCH" ]; then
    # No branch given: make a dedicated one off HEAD so we never collide with the main clone's
    # branch (git forbids two worktrees on the same branch).
    BRANCH="ci-container-$(date +%Y%m%d)"
    echo "Creating worktree at $DEST on new branch '$BRANCH' (off current HEAD)..."
    git worktree add -b "$BRANCH" "$DEST"
  elif git worktree add "$DEST" "$BRANCH" 2>/dev/null; then
    echo "Created worktree at $DEST on branch '$BRANCH'."
  else
    echo "Branch '$BRANCH' is checked out elsewhere; creating a detached worktree instead." >&2
    git worktree add --detach "$DEST" "$BRANCH"
  fi
fi

cat <<EOF

Done. Next:
  1. Open the workspace in the worktree:
       code "$DEST/positron-ci.code-workspace"
  2. Run "Dev Containers: Reopen in Container".

Rule: do container work ONLY in this worktree; keep native/host builds in:
  $MAIN
EOF
