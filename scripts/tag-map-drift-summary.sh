#!/usr/bin/env bash
# Renders check-test-tag-map.sh --json output as GitHub-Flavored Markdown, for
# a $GITHUB_STEP_SUMMARY. Kept separate from check-test-tag-map.sh's own
# human-readable text output (still the default, for terminal/local runs) so
# neither format has to compromise for the other's audience.
# Usage: bash scripts/tag-map-drift-summary.sh <drift.json>
# Always exits 0 -- this only renders; the caller determines pass/fail from
# the same drift.json (missing/stale/invalid_tags all empty).
set -uo pipefail
DRIFT_FILE="$1"

bullets() {
	jq -r --arg key "$1" '.[$key][] | "- `" + . + "`"' "$DRIFT_FILE"
}
has() {
	jq -e --arg key "$1" '.[$key] | length > 0' "$DRIFT_FILE" >/dev/null 2>&1
}

echo "### Test Tag Map Check"
echo ""
if jq -e '.missing == [] and .stale == [] and .invalid_tags == []' "$DRIFT_FILE" >/dev/null 2>&1; then
	echo ":white_check_mark: All Positron dirs are mapped, no map entries are stale, and every mapped tag is valid."
else
	if has missing; then
		echo "#### :x: Missing from map"
		echo ""
		bullets missing
		echo ""
		echo "Add each to the map: a feature tag list (e.g. \`[\"@:console\"]\`) or \`[]\` if it has no e2e coverage."
		echo ""
	fi
	if has stale; then
		echo "#### :x: Stale entries"
		echo ""
		bullets stale
		echo ""
		echo "Remove each from the map, or update the path if it moved."
		echo ""
	fi
	if has invalid_tags; then
		echo "#### :x: Invalid tags"
		echo ""
		bullets invalid_tags
		echo ""
		echo "Fix the tag name, or map the dir to \`[]\` if the feature has no e2e coverage."
		echo ""
	fi
fi

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
