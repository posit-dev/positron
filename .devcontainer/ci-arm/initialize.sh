#!/usr/bin/env bash
# Runs on the HOST before the container is created (devcontainer initializeCommand).
# Detects the checkout path and the git common dir so docker-compose can bind-mount both
# at their real host paths — which is what makes a git *worktree* work inside the container
# (worktree git metadata uses absolute host paths). Harmless for a normal clone.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"   # .devcontainer/ci-arm
ROOT="$(cd "$HERE/../.." && pwd)"       # the checkout root (worktree or clone)
ENV="$HERE/.env"

GITCOMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || echo "$ROOT/.git")"
case "$GITCOMMON" in
  /*) : ;;                                                  # already absolute
  *)  GITCOMMON="$(cd "$ROOT" && cd "$(dirname "$GITCOMMON")" && pwd)/$(basename "$GITCOMMON")" ;;
esac

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
