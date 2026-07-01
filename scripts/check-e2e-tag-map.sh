#!/usr/bin/env bash
# LOCAL / MANUAL full-sweep audit utility (not run by CI). Lists every Positron
# source dir that has no entry in e2e-tag-paths-map.json. The per-PR check in
# pr-tags-parse.sh is scoped to the dirs each PR touches; run this by hand for an
# initial audit or a full sweep of the whole tree.
# Usage: scripts/check-e2e-tag-map.sh [--warn-only]
# Env: MAP_FILE overrides the map path (used by tests).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP_FILE="${MAP_FILE:-$REPO_ROOT/.github/workflows/e2e-tag-paths-map.json}"
WARN_ONLY=false
[[ "${1:-}" == "--warn-only" ]] && WARN_ONLY=true

if [[ ! -f "$MAP_FILE" ]]; then
	echo "Map file not found: $MAP_FILE" >&2
	exit 1
fi

# Enumerate every Positron source dir (any `positron*` feature-root dir anywhere
# under src/ or extensions/, wherever it lives) as a repo-relative prefix with a
# trailing slash, matching the map's key format. `-prune` stops at each feature
# root so nested positron subdirs aren't listed separately. Build output (out/),
# vendored deps (node_modules/), and test dirs (test/, tests/, *-tests/) are
# excluded -- they're not feature source. `while read` (not `mapfile`) keeps this
# bash 3.2 compatible (macOS default).
expected=()
while IFS= read -r d; do
	expected+=("$d")
done < <(
	cd "$REPO_ROOT" || exit 1
	find src extensions -type d \( -name node_modules -o -name out \) -prune \
		-o -type d -iname 'positron*' -prune -print 2>/dev/null \
		| grep -viE '(^|/)(test|tests)(/|$)' \
		| grep -viE '(^|/)[a-z-]*-tests?(/|$)' \
		| sed 's#$#/#' | sort -u
)

missing=()
for prefix in "${expected[@]}"; do
	if ! jq -e --arg k "$prefix" 'has($k)' "$MAP_FILE" >/dev/null; then
		missing+=("$prefix")
	fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
	echo "All Positron dirs/extensions are mapped."
	exit 0
fi

echo "The following paths are missing from $(basename "$MAP_FILE"):"
printf '  - %s\n' "${missing[@]}"
echo ""
echo "Add each to the map: a feature tag list (e.g. [\"@:console\"]) or [] if it has no e2e coverage."

$WARN_ONLY && { echo "(--warn-only: not failing)"; exit 0; }
exit 1
