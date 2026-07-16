#!/usr/bin/env bash
# Get the ci-arm CI lab ready to run tests, from any starting state, in one command.
#
# Runs on the HOST (it drives `docker compose`), from anywhere -- it cd's to its own directory so
# Compose finds this checkout's docker-compose.yml + .env. It collapses the manual runbook
# (initialize -> compose up -> detect cold/warm/hot -> build-if-needed -> per-start setup) into one
# idempotent step, so no phase can be skipped or run out of order. Pair it with run-e2e.sh:
#
#   ./.devcontainer/ci-arm/ci-lab-up.sh [<branch>]
#   docker compose exec -T test bash -lc \
#     "cd \$POSITRON_WORKSPACE_PATH && ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/<area>/<f>.test.ts --workers=1"
#
# With <branch> it points the worktree at that branch first (fetch + checkout), then reconciles
# dependencies and recompiles out/ so the build matches the new source. Without it, the current
# checkout is assumed already built. A cold build takes ~10 minutes -- run this in the background
# and wait for it to exit; a clean exit means ready. Re-running is safe and fast when nothing changed.
set -euo pipefail

BRANCH=""
case "${1:-}" in
	-h | --help) echo "usage: ci-lab-up.sh [<branch>]  (see header comment for details)"; exit 0 ;;
	-*) echo "ci-lab-up: unknown option '$1'" >&2; exit 2 ;;
	"") : ;;
	*) BRANCH="$1" ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .devcontainer/ci-arm
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"                                             # so `docker compose` finds this checkout

step() { printf '\n=== ci-lab-up: %s ===\n' "$1"; }

# Run a command inside the test container from the workspace root, failing loudly (a masked failure
# inside a pipe or an && / || list is the whole reason this wrapper sets -e and pipefail).
in_ctr() { docker compose exec -T test bash -lc "set -eo pipefail; cd \"\$POSITRON_WORKSPACE_PATH\" && $1"; }

# 1. Optional branch switch (host-side git). Refuse on a dirty tree so we never half-switch or
#    silently carry uncommitted changes onto another branch.
if [ -n "$BRANCH" ]; then
	step "checkout $BRANCH"
	if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
		echo "ci-lab-up: ERROR: working tree is dirty; commit or stash before switching branches" >&2
		git -C "$REPO_ROOT" status --short >&2
		exit 1
	fi
	git -C "$REPO_ROOT" fetch origin "$BRANCH"
	git -C "$REPO_ROOT" checkout "$BRANCH"
fi

# 2. Workspace env (.env: bind-mount paths + a per-checkout COMPOSE_PROJECT_NAME). Idempotent.
step "initialize"
./initialize.sh

# 3. Bring up the stack (waits for the postgres healthcheck). Idempotent.
step "docker compose up -d"
docker compose up -d

# 4. Is a usable build present? The marker file alone isn't enough -- a switched branch or an
#    interrupted build can leave the marker while out/main.js or node_modules are gone, which is
#    exactly the "warm but Cannot find module" trap. Check the artifacts too.
step "build state"
# $() below is meant to run inside the container, not expand on the host, hence single quotes:
# shellcheck disable=SC2016
STATE="$(in_ctr '{ [ -f .build/.ci-arm-state/complete ] && [ -f out/main.js ] && [ -n "$(ls -A node_modules 2>/dev/null)" ]; } && echo READY || echo COLD' | tail -n1)"
echo "ci-lab-up: build is $STATE"

if [ "$STATE" = COLD ]; then
	# 5. First-time (or recovery) build: ~10 min. Blocks until done; log kept for failures.
	step "cold build (post-create.sh, ~10 min)"
	in_ctr './.devcontainer/ci-arm/post-create.sh 2>&1 | tee /tmp/post-create.log'
elif [ -n "$BRANCH" ]; then
	# Build present but we just switched branches: reconcile deps and recompile out/ so both match
	# the new source. (Without a branch switch the current checkout is assumed already built.)
	step "reconcile dependencies"
	# $() below is meant to run inside the container, not expand on the host, hence single quotes:
	# shellcheck disable=SC2016
	in_ctr '
		[ "$(sha256sum package-lock.json | cut -d" " -f1)" = "$(cat .build/.ci-arm-state/deps.sha 2>/dev/null)" ] || ./.devcontainer/ci-arm/reinstall-deps.sh root
		[ "$(sha256sum test/e2e/package-lock.json | cut -d" " -f1)" = "$(cat .build/.ci-arm-state/e2e-deps.sha 2>/dev/null)" ] || ./.devcontainer/ci-arm/reinstall-deps.sh e2e
	'
	step "recompile out/ (incremental)"
	in_ctr 'npm exec -- npm-run-all --max_old_space_size=4095 -lp compile 2>&1 | tee /tmp/compile.log'
fi

# 6. Per-start setup (display/VNC, license symlink, postgres check). Idempotent, always safe.
step "per-start setup (post-start.sh)"
in_ctr './.devcontainer/ci-arm/post-start.sh'

step "ready"
cat <<'MSG'
ci-lab-up: the lab is ready. Run a spec with:
  docker compose exec -T test bash -lc \
    "cd \$POSITRON_WORKSPACE_PATH && ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/<area>/<file>.test.ts --workers=1"
MSG
