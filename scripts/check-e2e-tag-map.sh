#!/usr/bin/env bash
# LOCAL / MANUAL full-sweep audit utility (not run by CI). Lists every Positron
# source dir that has no entry in e2e-tag-paths-map.json. The per-PR check in
# pr-tags-parse.sh is scoped to the dirs each PR touches; run this by hand for an
# initial audit or a full sweep of the whole tree.
# Usage: scripts/check-e2e-tag-map.sh [--warn-only]
# Env: MAP_FILE overrides the map path (used by tests).
set -uo pipefail

# positron_dir_of: the shared "path -> mappable positron dir (or nothing)" rule.
# shellcheck source=/dev/null
source "$(cd "$(dirname "$0")" && pwd)/lib/pr-tags-lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP_FILE="${MAP_FILE:-$REPO_ROOT/.github/workflows/e2e-tag-paths-map.json}"
WARN_ONLY=false
[[ "${1:-}" == "--warn-only" ]] && WARN_ONLY=true

if [[ ! -f "$MAP_FILE" ]]; then
	echo "Map file not found: $MAP_FILE" >&2
	exit 1
fi

# Discover every `positron*` feature-root dir under src/ and extensions/
# (`-prune` stops at each root so nested subdirs aren't listed; node_modules is
# pruned for speed). Each is normalized through positron_dir_of, which owns the
# trailing-slash format and the test/build/vendor exclusions -- the same rule
# find_unmapped_positron_dirs uses, so the two can't drift. `while read` (not
# `mapfile`) keeps this bash 3.2 compatible (macOS default).
expected=()
while IFS= read -r d; do
	dir="$(positron_dir_of "$d")"
	[[ -n "$dir" ]] && expected+=("$dir")
done < <(
	cd "$REPO_ROOT" || exit 1
	find src extensions -type d -name node_modules -prune \
		-o -type d -iname 'positron*' -prune -print 2>/dev/null | sort -u
)

missing=()
for prefix in "${expected[@]}"; do
	if ! jq -e --arg k "$prefix" 'has($k)' "$MAP_FILE" >/dev/null; then
		missing+=("$prefix")
	fi
done

# Tag health. HARD (#1): every tag the map uses must be a real tag declared in
# test-tags.ts -- a typo'd or deleted tag is a genuine error. ADVISORY (#2): a
# valid tag that no e2e test currently carries is surfaced but NOT failed -- the
# enum declaring the tag signals intent (a suite mid-migration or coming back),
# so we don't force it to [] or block on it.
ENUM_FILE="${ENUM_FILE:-$REPO_ROOT/test/e2e/infra/test-runner/test-tags.ts}"
TESTS_DIR="${TESTS_DIR:-$REPO_ROOT/test/e2e/tests}"
invalid_tags=()
untested_tags=()
if [[ -f "$ENUM_FILE" ]]; then
	valid_tags="$(grep -oE "'@:[a-zA-Z0-9_-]+'" "$ENUM_FILE" | tr -d "'" | sort -u)"
	while IFS= read -r tag; do
		[[ -z "$tag" ]] && continue
		if ! printf '%s\n' "$valid_tags" | grep -qxF "$tag"; then
			invalid_tags+=("$tag")
			continue
		fi
		# Resolve the tag value to its enum NAME, then look for a tags.NAME reference.
		name="$(grep -E "= '${tag}'," "$ENUM_FILE" | sed -nE 's/^[[:space:]]*([A-Z0-9_]+)[[:space:]]*=.*/\1/p' | head -1)"
		if [[ -n "$name" ]] && ! grep -rqE "tags\.${name}\b" "$TESTS_DIR" 2>/dev/null; then
			untested_tags+=("$tag")
		fi
	done < <(jq -r '.[][]?' "$MAP_FILE" | sort -u)
fi

# Advisory (never fails): valid tags with no test carrying them today.
if [[ ${#untested_tags[@]} -gt 0 ]]; then
	echo "Note: mapped tag(s) with no e2e test yet (ok if a suite is mid-migration or planned):"
	printf '  - %s\n' "${untested_tags[@]}"
	echo ""
fi

if [[ ${#missing[@]} -eq 0 && ${#invalid_tags[@]} -eq 0 ]]; then
	echo "All Positron dirs are mapped and every mapped tag is valid."
	exit 0
fi

if [[ ${#missing[@]} -gt 0 ]]; then
	echo "The following paths are missing from $(basename "$MAP_FILE"):"
	printf '  - %s\n' "${missing[@]}"
	echo "Add each to the map: a feature tag list (e.g. [\"@:console\"]) or [] if it has no e2e coverage."
	echo ""
fi
if [[ ${#invalid_tags[@]} -gt 0 ]]; then
	echo "The following map tags are not declared in test-tags.ts:"
	printf '  - %s\n' "${invalid_tags[@]}"
	echo "Fix the tag name, or map the dir to [] if the feature has no e2e coverage."
	echo ""
fi

$WARN_ONLY && { echo "(--warn-only: not failing)"; exit 0; }
exit 1
