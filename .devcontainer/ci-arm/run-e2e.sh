#!/usr/bin/env bash
# Run Positron e2e specs headlessly with the full environment the tests require, so a CLI/agent run
# (docker compose exec) matches what the Dev Containers UI -- and CI -- would give you. It sets up,
# in one place, the things that are easy to forget and that fail confusingly (or silently) when
# missing:
#
#   - The four interpreter version selectors the e2e setup demands. test/e2e/tests/_test.setup.ts
#     throws unless all four are set. Already-exported values win (Dev Containers injects them from
#     devcontainer.json's containerEnv); anything unset is read straight from devcontainer.json, so
#     both paths use identical, canonical values with no guessing.
#   - DISPLAY (the headless Xvnc display) so the app can render.
#   - GITHUB_ACTIONS=true, so image-comparison tests actually compare instead of silently skipping
#     (compareImages() is gated on it -- without it those tests pass without asserting anything).
#   - --project e2e-electron, unless the caller already passed a --project.
#
# Usage (inside the container, or via `docker compose exec test bash -lc`):
#   ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/plots/plots.test.ts --workers=1
#   ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/search/search.test.ts --grep @:search
# Every argument passes straight through to `npx playwright test`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${POSITRON_WORKSPACE_PATH:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
DEVCONTAINER_JSON="$SCRIPT_DIR/devcontainer.json"

# Resolve the four interpreter selectors: keep any already exported, fill the rest from
# devcontainer.json (one source of truth) so the CLI path and the Dev Containers path agree.
for key in POSITRON_PY_VER_SEL POSITRON_R_VER_SEL POSITRON_PY_ALT_VER_SEL POSITRON_R_ALT_VER_SEL; do
	if [ -z "${!key:-}" ]; then
		val="$(grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$DEVCONTAINER_JSON" 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"
		if [ -z "$val" ]; then
			echo "run-e2e: ERROR: $key is unset and not found in $DEVCONTAINER_JSON" >&2
			exit 1
		fi
		export "$key=$val"
	fi
done

# Headless display + the flag that makes image-comparison tests run (they no-op without it).
export DISPLAY="${DISPLAY:-:10}"
export GITHUB_ACTIONS="${GITHUB_ACTIONS:-true}"

# Default the Playwright project unless the caller chose one.
args=("$@")
has_project=false
for a in "$@"; do
	case "$a" in
		--project | --project=*) has_project=true ;;
	esac
done
if ! $has_project; then
	args+=(--project e2e-electron)
fi

echo "run-e2e: PY=$POSITRON_PY_VER_SEL R=$POSITRON_R_VER_SEL PY_ALT=$POSITRON_PY_ALT_VER_SEL R_ALT=$POSITRON_R_ALT_VER_SEL DISPLAY=$DISPLAY GITHUB_ACTIONS=$GITHUB_ACTIONS"
echo "run-e2e: npx playwright test ${args[*]}"

cd "$REPO_ROOT"
exec npx playwright test "${args[@]}"
