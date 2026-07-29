#!/usr/bin/env bash
# Get the ci-arm CI lab ready to run tests, from any starting state, in one command.
#
# Runs on the HOST (it drives `docker compose`), from anywhere -- it cd's to its own directory so
# Compose finds this checkout's docker-compose.yml + .env. It collapses the manual runbook
# (initialize -> compose up -> detect cold/warm/hot -> build-if-needed -> per-start setup) into one
# idempotent step, so no phase can be skipped or run out of order. Pair it with run-e2e.sh:
#
#   ./.devcontainer/ci-arm/ci-lab-up.sh [<ref> | --local]
#   docker compose exec -T test bash -lc \
#     "cd \$POSITRON_WORKSPACE_PATH && ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/<area>/<f>.test.ts --workers=1"
#
# Three modes, differing only in whether source is reconciled before the run:
#
#   <ref>     point the worktree at that ref first, then reconcile deps and recompile out/ so the
#             build matches the new source. Resolved from origin, else from a local ref/SHA -- so a
#             local-only instrumentation branch works without pushing it.
#   --local   no git operation; reconcile and recompile against the current working tree. Use this
#             after editing source in the lab worktree by hand.
#   (none)    the current checkout is assumed already built; nothing is recompiled.
#
# A cold build takes ~10 minutes -- run this in the background and wait for it to exit. Re-running is
# safe and fast when nothing changed.
#
# CHECKING THE RESULT: grep stdout for `ci-lab-up: SUCCESS` or `ci-lab-up: FAILED` (the latter names
# the phase). Do not rely on `$?` if you piped through `tee` -- the pipeline reports tee's status, not
# this script's. Capture with `2>&1` so the diagnostics behind a failure land in the log too:
#
#   ./.devcontainer/ci-arm/ci-lab-up.sh <ref> 2>&1 | tee /tmp/ci-lab-up.log
set -euo pipefail

BRANCH=""
RECONCILE=false
case "${1:-}" in
	-h | --help) echo "usage: ci-lab-up.sh [<ref> | --local]  (see header comment for details)"; exit 0 ;;
	--local) RECONCILE=true ;;
	-*) echo "ci-lab-up: unknown option '$1'" >&2; exit 2 ;;
	"") : ;;
	*) BRANCH="$1"; RECONCILE=true ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # .devcontainer/ci-arm
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$SCRIPT_DIR"                                             # so `docker compose` finds this checkout

# Every phase announces itself and records itself, so the EXIT trap below can name the phase that
# failed. That trailer is the only reliable failure signal a caller has: the usual
# `ci-lab-up.sh ... 2>&1 | tee log` invocation reports tee's exit status (always 0), masking ours.
#
# Both trailers go to stdout, deliberately. Diagnostics belong on stderr, but a status trailer that
# lands on a different stream than its SUCCESS counterpart is a trap: `... | tee log` would capture
# SUCCESS and drop FAILED, leaving a log with no failure marker at all.
CURRENT_STEP="startup"
step() { CURRENT_STEP="$1"; printf '\n=== ci-lab-up: %s ===\n' "$1"; }
on_exit() {
	local rc=$?
	[ "$rc" -eq 0 ] || printf '\nci-lab-up: FAILED at step %s (exit %d)\n' "'$CURRENT_STEP'" "$rc"
}
trap on_exit EXIT

# Run a command inside the test container from the workspace root, failing loudly (a masked failure
# inside a pipe or an && / || list is the whole reason this wrapper sets -e and pipefail).
in_ctr() { docker compose exec -T test bash -lc "set -eo pipefail; cd \"\$POSITRON_WORKSPACE_PATH\" && $1"; }

# 1. Optional ref switch (host-side git). Refuse on a dirty tree so we never half-switch or
#    silently carry uncommitted changes onto another ref.
if [ -n "$BRANCH" ]; then
	step "checkout $BRANCH"
	DIRTY="$(git -C "$REPO_ROOT" status --porcelain)"
	if [ -n "$DIRTY" ]; then
		# Classify the dirt. A gitlink left at a different commit than HEAD records (a stale
		# submodule checkout from an earlier session) shows up here as ` M <path>` and is
		# indistinguishable from an edited file in porcelain output -- but "commit or stash" is
		# the wrong advice for it, since committing a drifted pointer is actively harmful.
		SUBMODULE_PATHS="$(git -C "$REPO_ROOT" config -f "$REPO_ROOT/.gitmodules" \
			--get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{print $2}' || true)"
		DRIFTED=""
		OTHER_DIRT=false
		while IFS= read -r line; do
			[ -n "$line" ] || continue
			if printf '%s\n' "$SUBMODULE_PATHS" | grep -qxF -- "${line:3}"; then
				DRIFTED="$DRIFTED ${line:3}"
			else
				OTHER_DIRT=true
			fi
		done <<-EOF
			$DIRTY
		EOF

		# Report drift whenever it's present, even alongside ordinary edits: stashing everything
		# and retrying would leave the gitlink exactly where it was and fail again.
		if [ -n "$DRIFTED" ]; then
			echo "ci-lab-up: ERROR: submodule pointer(s) differ from what HEAD records:$DRIFTED" >&2
			echo "ci-lab-up: that is a stale submodule checkout, not local work -- do NOT commit or stash it. Restore with:" >&2
			echo "ci-lab-up:   git -C '$REPO_ROOT' submodule update --init --recursive$DRIFTED" >&2
		fi
		if [ "$OTHER_DIRT" = true ]; then
			if [ -n "$DRIFTED" ]; then
				echo "ci-lab-up: ERROR: separately, there are uncommitted changes; commit or stash those too" >&2
			else
				echo "ci-lab-up: ERROR: working tree is dirty; commit or stash before switching refs" >&2
			fi
			git -C "$REPO_ROOT" status --short >&2
		fi
		exit 1
	fi

	# Resolve from origin first (the common case: a pushed branch), then from a local ref. The
	# local fallback is what makes a throwaway instrumentation branch usable without pushing it.
	if git -C "$REPO_ROOT" fetch origin "$BRANCH"; then
		echo "ci-lab-up: resolved '$BRANCH' from origin"
	elif git -C "$REPO_ROOT" rev-parse --verify --quiet "$BRANCH^{commit}" >/dev/null; then
		echo "ci-lab-up: '$BRANCH' is not on origin (fetch failed above); using the local ref"
	else
		echo "ci-lab-up: ERROR: cannot resolve '$BRANCH' -- tried fetching it from origin and" >&2
		echo "ci-lab-up: resolving it as a local branch, tag, or SHA. Neither worked." >&2
		exit 1
	fi
	git -C "$REPO_ROOT" checkout "$BRANCH"
fi

# 2. Workspace env (.env: bind-mount paths + a per-checkout COMPOSE_PROJECT_NAME) and submodule
#    checkout. Host-side, so the private ai-lib submodule clones with your credentials. Idempotent.
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
elif [ "$RECONCILE" = true ]; then
	# Build present, but source moved under it (a ref switch, or --local after editing by hand):
	# reconcile deps and recompile out/ so both match the current source. Skipped without either,
	# where the current checkout is assumed already built.
	step "reconcile dependencies"
	# Root deps go through fast-install.ts, not a root-lockfile-only sha compare: it hashes every
	# dir in build/npm/dirs.ts (root plus each extension), so a branch that only changes an
	# extension's own package.json (no root package-lock.json change) still triggers a reinstall
	# instead of silently keeping a stale node_modules from the branch we switched off of.
	# $() below is meant to run inside the container, not expand on the host, hence single quotes:
	# shellcheck disable=SC2016
	in_ctr '
		node build/npm/fast-install.ts
		./.devcontainer/ci-arm/mark-build-state.sh root
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
ci-lab-up: SUCCESS -- the lab is ready. Run a spec with:
  docker compose exec -T test bash -lc \
    "cd \$POSITRON_WORKSPACE_PATH && ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/<area>/<file>.test.ts --workers=1"
MSG

# "Ready" without a reconcile only means the last build's artifacts are present -- it says nothing
# about whether they match the working tree. Spell that out rather than let it read as "your edits
# are compiled", which is the trap in the no-argument path.
if [ "$RECONCILE" = false ] && [ "$STATE" != COLD ]; then
	cat <<'MSG'

Note: nothing was recompiled this run, so out/ reflects whatever was last built here,
not your current working tree. If you edited source, rerun with --local.
MSG
fi
