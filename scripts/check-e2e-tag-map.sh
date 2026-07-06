#!/usr/bin/env bash
# Guardrail for e2e-tag-paths-map.json. Two independent checks:
#   1. Dir coverage: every Positron source dir has a map entry. LOCAL/MANUAL
#      full-sweep only (not run by CI) -- the per-PR check in pr-tags-parse.sh
#      is scoped to the dirs each PR touches and is the CI-facing equivalent.
#      Run this by hand for an initial audit or a full sweep of the whole tree.
#   2. Tag validity: every tag the map uses is a real tag declared in
#      test-tags.ts. This check IS run by CI (`--tags-only`, in
#      test-pull-request.yml) since it's static and doesn't need PR scoping --
#      a typo'd or deleted tag is a genuine error the moment it's introduced.
# Usage: scripts/check-e2e-tag-map.sh [--warn-only] [--tags-only]
#   --warn-only: report failures but exit 0 (used for local/manual runs).
#   --tags-only: skip check #1 (the tree-wide dir sweep) and run only check #2.
# Env: MAP_FILE overrides the map path (used by tests).
set -uo pipefail

# positron_dir_of, valid_enum_tags: shared rules with pr-tags-parse.sh so the
# two can't drift on what counts as a mappable dir or a real tag.
# shellcheck source=/dev/null
source "$(cd "$(dirname "$0")" && pwd)/lib/pr-tags-lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP_FILE="${MAP_FILE:-$REPO_ROOT/.github/workflows/e2e-tag-paths-map.json}"
WARN_ONLY=false
TAGS_ONLY=false
for arg in "$@"; do
	case "$arg" in
		--warn-only) WARN_ONLY=true ;;
		--tags-only) TAGS_ONLY=true ;;
	esac
done

if [[ ! -f "$MAP_FILE" ]]; then
	echo "Map file not found: $MAP_FILE" >&2
	exit 1
fi

missing=()
if ! $TAGS_ONLY; then
	# Discover every `positron*` feature-root dir under src/ and extensions/
	# (`-prune` stops at each root so nested subdirs aren't listed; node_modules
	# is pruned for speed). Each is normalized through positron_dir_of, which
	# owns the trailing-slash format and the test/build/vendor exclusions -- the
	# same rule find_unmapped_positron_dirs uses, so the two can't drift.
	# `while read` (not `mapfile`) keeps this bash 3.2 compatible (macOS default).
	expected=()
	while IFS= read -r d; do
		dir="$(positron_dir_of "$d")"
		[[ -n "$dir" ]] && expected+=("$dir")
	done < <(
		cd "$REPO_ROOT" || exit 1
		find src extensions -type d -name node_modules -prune \
			-o -type d -iname 'positron*' -prune -print 2>/dev/null | sort -u
	)

	for prefix in "${expected[@]}"; do
		if ! jq -e --arg k "$prefix" 'has($k)' "$MAP_FILE" >/dev/null; then
			missing+=("$prefix")
		fi
	done
fi

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
	valid_tags="$(valid_enum_tags "$ENUM_FILE")"
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
	$TAGS_ONLY && echo "Every mapped tag is valid." || echo "All Positron dirs are mapped and every mapped tag is valid."
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
