#!/usr/bin/env bash
# Create (or reuse) a dedicated git worktree for CI dev-container work, so container (Linux) builds
# never share a checkout with native (host) builds. See README "How storage works". Run on the HOST
# from any full Positron checkout (a clone or an existing worktree).
#
# Usage: ./.devcontainer/ci-arm/setup-worktree.sh [dest-path] [branch]
#   dest-path  default: <clone>-ci      (or $POSITRON_CI_WORKTREE)
#   branch     default: a new branch ci-container-<date> off current HEAD
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(cd "$HERE/../.." && pwd)"
cd "$MAIN"

# Must be a full clone -- the compile needs git history. (Running from a worktree is fine: git
# worktree commands operate on the whole repo, so a new worktree can be created from any of them.)
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  echo "This is a shallow clone; the build needs full history. Re-clone at full depth." >&2
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
elif [ -z "$BRANCH" ]; then
  # No branch given: use a dedicated dated branch off HEAD so we never collide with the main clone's
  # branch (git forbids two worktrees on one branch). The branch can outlive a `git worktree remove`,
  # so reuse it if it already exists rather than failing on `add -b`.
  BRANCH="ci-container-$(date +%Y%m%d)"
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "Creating worktree at $DEST on existing branch '$BRANCH'..."
    git worktree add "$DEST" "$BRANCH"
  else
    echo "Creating worktree at $DEST on new branch '$BRANCH' (off current HEAD)..."
    git worktree add -b "$BRANCH" "$DEST"
  fi
else
  # User-specified branch. git forbids two worktrees on one branch, so fall back to a detached
  # checkout only for that specific case; surface any other error instead of masking it.
  if err="$(git worktree add "$DEST" "$BRANCH" 2>&1)"; then
    echo "Created worktree at $DEST on branch '$BRANCH'."
  elif printf '%s' "$err" | grep -qiE 'already (checked out|used)'; then
    echo "Branch '$BRANCH' is checked out elsewhere; creating a detached worktree instead." >&2
    git worktree add --detach "$DEST" "$BRANCH"
  else
    printf 'git worktree add failed:\n%s\n' "$err" >&2
    exit 1
  fi
fi

cat <<EOF

Done. Next, in the new worktree:
  1. Add your secrets (gitignored, so they aren't copied in -- the container needs them):
       cp "$MAIN/.devcontainer/ci-arm/.env"         "$DEST/.devcontainer/ci-arm/.env"          # or see README Setup
       cp "$MAIN/.devcontainer/ci-arm/license.txt"  "$DEST/.devcontainer/ci-arm/license.txt"
  2. Open the workspace and Reopen in Container:
       code "$DEST/positron-ci.code-workspace"

Rule: do container work ONLY in this worktree; keep native/host builds in:
  $MAIN
EOF
