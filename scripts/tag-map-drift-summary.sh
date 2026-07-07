#!/usr/bin/env bash
# Renders check-test-tag-map.sh --json output as GitHub-Flavored Markdown, for
# a $GITHUB_STEP_SUMMARY. Kept separate from check-test-tag-map.sh's own
# human-readable text output (still the default, for terminal/local runs) so
# neither format has to compromise for the other's audience.
# Usage: bash scripts/tag-map-drift-summary.sh <drift.json> [--condensed]
#   --condensed: a one-line pointer instead of the full breakdown -- for the
#     auto-fix job's summary, which runs against the same drift.json the
#     check-map job already rendered in full on the same run page.
# Always exits 0 -- this only renders; the caller determines pass/fail from
# the same drift.json (missing/stale/invalid_tags all empty).
set -uo pipefail
DRIFT_FILE="$1"
CONDENSED=false
[[ "${2:-}" == "--condensed" ]] && CONDENSED=true

bullets() {
	jq -r --arg key "$1" '.[$key][] | "- `" + . + "`"' "$DRIFT_FILE"
}
has() {
	jq -e --arg key "$1" '.[$key] | length > 0' "$DRIFT_FILE" >/dev/null 2>&1
}
count() {
	jq -r --arg key "$1" '.[$key] | length' "$DRIFT_FILE"
}
plural() {
	# plural <count> <singular-noun>: bare noun for 1, +s otherwise.
	[[ "$1" == "1" ]] && echo "$2" || echo "${2}s"
}

echo "### Test Tag Map Check"
echo ""

if jq -e '.missing == [] and .stale == [] and .invalid_tags == []' "$DRIFT_FILE" >/dev/null 2>&1; then
	echo ":white_check_mark: All Positron dirs are mapped, no map entries are stale, and every mapped tag is valid."
elif $CONDENSED; then
	parts=()
	has missing && parts+=("$(count missing) missing $(plural "$(count missing)" dir)")
	has stale && parts+=("$(count stale) stale $(plural "$(count stale)" entry)")
	has invalid_tags && parts+=("$(count invalid_tags) invalid $(plural "$(count invalid_tags)" tag)")
	# `$*` only joins with IFS's first char, not a multi-char separator -- build
	# the ", "-joined string by hand instead.
	joined=""
	for p in "${parts[@]}"; do
		[[ -z "$joined" ]] && joined="$p" || joined="$joined, $p"
	done
	echo "Found: $joined (see the check-map summary above for details)."
	echo ""
else
	if has missing; then
		echo "#### Missing from map"
		echo ""
		bullets missing
		echo ""
		echo "Add each to the map: a feature tag list (e.g. \`[\"@:console\"]\`) or \`[]\` if it has no e2e coverage."
		echo ""
	fi
	if has stale; then
		echo "#### Stale entries"
		echo ""
		bullets stale
		echo ""
		echo "Remove each from the map, or update the path if it moved."
		echo ""
	fi
	if has invalid_tags; then
		echo "#### Invalid tags"
		echo ""
		bullets invalid_tags
		echo ""
		echo "Fix the tag name, or map the dir to \`[]\` if the feature has no e2e coverage."
		echo ""
	fi
fi

if ! $CONDENSED; then
	if has untested_tags; then
		echo "<details><summary>:information_source: Mapped tag(s) with no e2e test yet (ok if a suite is mid-migration or planned)</summary>"
		echo ""
		bullets untested_tags
		echo ""
		echo "</details>"
		echo ""
	fi
	if has unresolved_tags; then
		echo "<details><summary>:warning: Could not resolve the enum member name for these tag(s)</summary>"
		echo ""
		bullets unresolved_tags
		echo ""
		echo "</details>"
		echo ""
	fi
fi
