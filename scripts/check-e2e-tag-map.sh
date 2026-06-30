#!/usr/bin/env bash
# Guardrail: every Positron feature directory and extension must have an entry
# in e2e-tag-paths-map.json (a real tag list OR an explicit [] meaning "no e2e
# coverage by design"). Flags any that are missing so the map can't silently rot.
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

# Enumerate the SOURCE directories/extensions that should be mapped, as
# repo-relative prefixes with a trailing slash (matching the map's key format).
# Test directories (test/e2e/tests/*) are intentionally NOT enumerated -- they
# are not in the map; their tags come from the files themselves (Task 3).
# `while read` (not `mapfile`) so the script runs under bash 3.2 (macOS default).
expected=()
while IFS= read -r d; do
	expected+=("$d")
done < <(
	cd "$REPO_ROOT" || exit 1
	for d in src/vs/workbench/contrib/positron*/ \
	         src/vs/workbench/services/positron*/ \
	         extensions/positron-*/; do
		[[ -d "$d" ]] && echo "$d"
	done
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
