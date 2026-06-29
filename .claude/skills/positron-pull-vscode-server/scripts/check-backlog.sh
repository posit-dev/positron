#!/usr/bin/env bash
# Report the backlog of unpulled rstudio/vscode-server commits.
#
# Usage: ./check-backlog.sh [baseline-sha]
#
# Use this when the user asks to pull a SINGLE PR/issue, to surface any OTHER
# portable commits that have accrued upstream since the last merge. The single
# requested PR is rarely the only thing waiting — this check stops the rest of
# the backlog from being silently skipped.
#
# <baseline-sha> is the upstream/main commit that corresponds to the last
# "upstream merge from vscode-server" commit in Positron's history. If omitted,
# the script derives it from the most recent "Brings in:" commit message.

set -euo pipefail

echo "Fetching upstream..."
git fetch upstream >/dev/null 2>&1

BASELINE="${1:-}"

if [ -z "$BASELINE" ]; then
	# Derive the baseline from the most recent "upstream merge from vscode-server"
	# commit. Search --all: the merge often lands on a dedicated
	# pull-vscode-server branch before it reaches main, so a main-only log misses
	# it. Take the highest PR number its "Brings in:" list mentions, find that
	# merge on upstream/main, and use it as the baseline (commits strictly after
	# it are the backlog).
	LAST_MERGE=$(git log --all --grep="upstream merge from vscode-server" \
		--date-order --format="%H" | head -1 || true)
	LAST_PR=$(git log -1 "$LAST_MERGE" --format="%B" 2>/dev/null \
		| grep -oE --color=never 'vscode-server#[0-9]+' \
		| grep -oE --color=never '[0-9]+' \
		| sort -n | tail -1 || true)

	if [ -z "$LAST_PR" ]; then
		echo "ERROR: Could not derive a baseline. Pass <baseline-sha> explicitly."
		echo "Recent upstream merges from vscode-server in Positron:"
		git log --oneline --grep="upstream merge from vscode-server" -5
		exit 1
	fi

	BASELINE=$(git log upstream/main --merges --no-color --oneline \
		--grep="pull request #${LAST_PR} " | head -1 | cut -d' ' -f1 || true)

	if [ -z "$BASELINE" ]; then
		echo "ERROR: Found last pulled PR #${LAST_PR} but could not locate its merge"
		echo "on upstream/main. Pass <baseline-sha> explicitly."
		exit 1
	fi

	echo "Last pulled PR appears to be #${LAST_PR} (merge ${BASELINE})."
fi

echo ""
echo "Merge commits on upstream/main since ${BASELINE}:"
echo "================================================="
MERGES=$(git log upstream/main --first-parent --oneline "${BASELINE}..upstream/main" || true)

if [ -z "$MERGES" ]; then
	echo "(none — nothing new upstream)"
	exit 0
fi

echo "$MERGES"

echo ""
echo "Heads up: the merges above are waiting upstream beyond the single PR you"
echo "named. Before triaging, confirm the baseline is shared: compare 'version'"
echo "and 'distro' in package.json on main vs upstream/main."
echo "  - If they MATCH, any 'Merge 1.NNN.0' / 'Merge rel-*' commits are"
echo "    reconciliation merges that brought vscode-server up to Positron's"
echo "    baseline (already in Positron); skip them but do NOT skip the feature/"
echo "    bugfix PRs around them."
echo "  - If they DIFFER, the repos have diverged — stop and sync the Microsoft"
echo "    baseline first (this skill ports across a shared baseline only)."
echo "update-extension-*, version-bump, and .github/Jenkins commits are"
echo "vscode-server tooling and are normally skipped. Surface the remaining"
echo "portable source PRs to the user before porting only the one they asked for."
