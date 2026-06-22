#!/usr/bin/env bash
# One-shot "start" for CI dev-container work. From your main Positron clone, on ANY branch:
#   1. create (or reuse) a dedicated worktree off your current commit (own branch, no contention)
#   2. open it in VS Code
# Then click "Reopen in Container" to land in the CI image. Run on the HOST.
#
# Usage: ./.devcontainer/ci-arm/start.sh [dest-path]
#   dest-path  default: <clone>-ci  (or $POSITRON_CI_WORKTREE)
#
# Deliberately NOT `set -e`: worktree setup is handled explicitly so we can give actionable guidance
# and never open VS Code on a failed setup.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(cd "$HERE/../.." && pwd)"
DEST="${1:-${POSITRON_CI_WORKTREE:-${MAIN}-ci}}"

# Step 1: create or reuse the worktree. setup-worktree.sh does the guards (full clone, not-a-worktree)
# and the branch logic; it prints its own specific error to stderr on failure.
if ! "$HERE/setup-worktree.sh" "$DEST"; then
  cat >&2 <<EOF

ERROR: couldn't set up the container worktree (see the message above). Nothing was opened.
What to do, by cause:
  - "Run this from your main clone, not from a worktree": cd to your main Positron clone (the one
    whose .git is a directory, not a file) and run start again.
  - "shallow clone": re-clone without --depth -- the build needs full git history.
  - "already checked out" (the branch is in use by another worktree): open that worktree instead,
    or pick a different destination:   $0 /path/to/empty/dir
  - "already exists" (the path is taken by something that isn't our worktree): remove it, or choose
    a different destination:           $0 /path/to/empty/dir
EOF
  exit 1
fi

# Step 2: open the worktree's workspace in VS Code.
WS="$DEST/positron-ci.code-workspace"
if [ ! -f "$WS" ]; then
  cat >&2 <<EOF

ERROR: $WS not found in the worktree.
Your current branch doesn't include the CI dev container yet (it lands once this work is merged).
For now, run start from a branch that has '.devcontainer/ci-arm/'. Nothing was opened.
EOF
  exit 1
fi

# The container needs .env + license.txt, which are gitignored and so are NOT copied into a fresh
# worktree. Don't open a container that would fail the build; tell the user exactly how to add them.
CFG="$DEST/.devcontainer/ci-arm"
MAINCFG="$MAIN/.devcontainer/ci-arm"
missing=""
[ -f "$CFG/.env" ]         || missing="$missing .env"
[ -f "$CFG/license.txt" ]  || missing="$missing license.txt"
if [ -n "$missing" ]; then
  echo >&2
  echo "Worktree ready, but it's missing:$missing" >&2
  echo "(these are gitignored, so a fresh worktree doesn't get them — the container needs them)." >&2
  echo "Add them in the worktree, then run start again:" >&2
  for f in $missing; do
    if [ -f "$MAINCFG/$f" ]; then
      echo "  cp \"$MAINCFG/$f\" \"$CFG/$f\"" >&2
    elif [ "$f" = ".env" ]; then
      echo "  cp \"$CFG/.env.example\" \"$CFG/.env\"   # then fill in the Postgres info from 1Password" >&2
    else
      echo "  # copy the 'Positron Server private key' from 1Password to \"$CFG/license.txt\"" >&2
    fi
  done
  echo "Nothing opened yet." >&2
  exit 1
fi

echo
if command -v code >/dev/null 2>&1; then
  echo "Opening $WS in VS Code..."
  code "$WS"
  echo 'Now click "Reopen in Container" (or Cmd-Shift-P -> Dev Containers: Reopen in Container).'
else
  echo "VS Code's 'code' command isn't on your PATH. Open it manually:"
  echo "    code \"$WS\""
  echo 'then click "Reopen in Container".'
fi
