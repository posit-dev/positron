#!/usr/bin/env bash
# Enumerate new rstudio/vscode-server commits for triage.
#
# Usage: ./enumerate-upstream.sh <baseline-sha>
#
# <baseline-sha> is the upstream/main commit that corresponds to the last
# "upstream merge from vscode-server" commit in Positron's history.
#
# Assumes Positron and vscode-server are on the same Microsoft VSCode baseline.
# If Microsoft commits appear in the range, the script exits with an error —
# sync the Microsoft baseline first.

set -euo pipefail

if [ -z "${1:-}" ]; then
	echo "Usage: $0 <baseline-sha>"
	echo ""
	echo "Recent upstream merges from vscode-server in Positron:"
	git log --oneline --grep="upstream merge from vscode-server" -5
	exit 1
fi

BASELINE="$1"

echo "Fetching upstream..."
git fetch upstream

# Sanity check: if Microsoft commits appear in the range, the repos are not on
# the same baseline and this skill should not be used.
MICROSOFT_COMMITS=$(git log upstream/main --no-merges --oneline \
	--ancestry-path "${BASELINE}..upstream/main" \
	--author="microsoft\.com" || true)

if [ -n "$MICROSOFT_COMMITS" ]; then
	echo ""
	echo "ERROR: Microsoft-authored commits found in upstream/main since ${BASELINE}."
	echo "Positron and vscode-server are not on the same Microsoft VSCode baseline."
	echo "Sync the Microsoft baseline before using this skill."
	echo ""
	echo "Microsoft commits:"
	echo "$MICROSOFT_COMMITS"
	exit 1
fi

echo ""
echo "All commits on upstream/main since ${BASELINE}:"
echo "================================================"
git log upstream/main --oneline --ancestry-path "${BASELINE}..upstream/main"

echo ""
echo "Candidates (excluding merges):"
echo "=============================="
CANDIDATES=$(git log upstream/main --no-merges --oneline \
	--ancestry-path "${BASELINE}..upstream/main" || true)

if [ -z "$CANDIDATES" ]; then
	echo "(none)"
else
	echo "$CANDIDATES"
	echo ""
	echo "File changes per candidate:"
	echo "---------------------------"
	while IFS= read -r line; do
		SHA=$(echo "$line" | cut -d' ' -f1)
		echo ""
		echo "▶ $line"
		git show "$SHA" --stat --format="" | tail -n +1
	done <<< "$CANDIDATES"
fi
