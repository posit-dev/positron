#!/usr/bin/env bash
# Runs on the HOST before the container is created (devcontainer initializeCommand).
# Detects the checkout path and the git common dir so docker-compose can bind-mount both
# at their real host paths — which is what makes a git *worktree* work inside the container
# (worktree git metadata uses absolute host paths). Harmless for a normal clone.
#
# Also checks out any uninitialized submodules. This has to happen host-side: ai-lib is private
# and the container has no GitHub credentials, so build/npm/postinstall.ts aborts the whole root
# install if it has to clone ai-lib itself.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"   # .devcontainer/ci-arm
ROOT="$(cd "$HERE/../.." && pwd)"       # the checkout root (worktree or clone)
ENV="$HERE/.env"

GITCOMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo "$ROOT/.git")"
case "$GITCOMMON" in
  /*) : ;;                                                  # already absolute
  *)  GITCOMMON="$(cd "$ROOT" && cd "$(dirname "$GITCOMMON")" && pwd)/$(basename "$GITCOMMON")" ;;
esac

# Check out any submodule that isn't there yet. On failure, name the two things that actually
# cause it -- git reports only "clone ... failed", which points at neither:
#   - leftovers in the submodule path (e.g. packages/*/node_modules from an earlier session's
#     install) with no .git. Some git versions clone into a non-empty directory and some refuse,
#     so this is diagnosed after the attempt rather than pre-empting it.
#   - no read access to a private submodule (ai-lib).
# Removing tens of MB unattended isn't this script's call to make, so it prints the command.
if [ -f "$ROOT/.gitmodules" ]; then
  while read -r _ SUB; do
    [ -n "$SUB" ] || continue
    [ -e "$ROOT/$SUB/.git" ] && continue                      # already checked out
    LEFTOVERS=false
    [ -n "$(ls -A "$ROOT/$SUB" 2>/dev/null)" ] && LEFTOVERS=true
    echo "ci-arm initialize: checking out submodule $SUB"
    if ! git -C "$ROOT" submodule update --init --recursive "$SUB"; then
      echo "ci-arm initialize: ERROR: could not check out submodule '$SUB'." >&2
      if [ "$LEFTOVERS" = true ]; then
        echo "ci-arm initialize: '$SUB' already held files but was not a submodule checkout, which is" >&2
        echo "ci-arm initialize: the likely cause. Remove it and rerun:" >&2
        echo "ci-arm initialize:   rm -rf '$ROOT/$SUB'" >&2
      else
        echo "ci-arm initialize: check that you have read access to it (ai-lib is private)." >&2
      fi
      exit 1
    fi
  done < <(git -C "$ROOT" config -f "$ROOT/.gitmodules" --get-regexp '^submodule\..*\.path$')
fi

[ -f "$ENV" ] || cp "$HERE/.env.example" "$ENV"

upsert() {  # key value file — replace the line if present, else append
  local k="$1" v="$2" f="$3" tmp
  if grep -qE "^${k}=" "$f"; then
    tmp="$(mktemp)"; grep -vE "^${k}=" "$f" > "$tmp"; mv "$tmp" "$f"
  fi
  printf '%s=%s\n' "$k" "$v" >> "$f"
}
upsert POSITRON_WORKSPACE_PATH "$ROOT" "$ENV"
upsert POSITRON_GIT_COMMON_DIR "$GITCOMMON" "$ENV"

# Compose's project name defaults to this directory's basename ("ci-arm"), identical for every
# checkout of this repo -- so two checkouts (e.g. your main dev checkout and a dedicated lab
# worktree) silently share one set of containers/volumes instead of erroring: whichever one runs
# `docker compose up` last wins, and the other's postCreate/postStart commands fail with confusing
# "not found" errors because the container is bind-mounted to a different path than expected. See
# README Gotchas: "One dev container per checkout at a time". Pin a project name derived from this
# checkout's own directory name so every checkout gets its own isolated containers automatically.
PROJECT="$(basename "$ROOT")"
PROJECT="$(printf '%s' "$PROJECT" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '-')"
upsert COMPOSE_PROJECT_NAME "$PROJECT" "$ENV"

echo "ci-arm initialize: workspace=$ROOT git-common=$GITCOMMON project=$PROJECT"
