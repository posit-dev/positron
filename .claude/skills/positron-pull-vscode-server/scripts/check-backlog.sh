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

ALL_MERGES=$(git log upstream/main --first-parent --no-color --oneline \
	"${BASELINE}..upstream/main" || true)

if [ -z "$ALL_MERGES" ]; then
	echo ""
	echo "Nothing new on upstream/main since ${BASELINE}."
	exit 0
fi

# Microsoft baseline merges (e.g. "Merge 1.118.0 from upstream",
# "Merge rel-blue-plumbago", "merge/1.NNN.0" branches) are never portable PRs:
# they are reconciliation merges that bring vscode-server up to a Microsoft
# VSCode baseline. Positron tracks that baseline independently, so these must
# never appear as candidates. Drop them before anything else.
CANDIDATES=$(echo "$ALL_MERGES" \
	| grep -viE 'Merge [0-9]+\.[0-9]+\.[0-9]+ from upstream' \
	| grep -viE 'Merge rel-' \
	| grep -viE 'merge/[0-9]+\.[0-9]+\.[0-9]+' || true)

echo ""
echo "Excluded Microsoft baseline merges (not portable):"
echo "=================================================="
echo "$ALL_MERGES" | grep --color=never -iE 'Merge [0-9]+\.[0-9]+\.[0-9]+ from upstream|Merge rel-|merge/[0-9]+\.[0-9]+\.[0-9]+' \
	|| echo "(none)"

# Decide whether an update-extension-* (rstudio.rstudio-workbench) bump is worth
# considering: only if Positron is BEHIND upstream. If Positron's product.json
# pins an equal-or-newer version, the bump is already covered — drop it.
PWB_MAIN=$(git show main:product.json 2>/dev/null \
	| grep -A1 '"rstudio.rstudio-workbench"' | grep -oE --color=never '[0-9]{4}\.[0-9]+\.[0-9]+' | head -1 || true)
PWB_UPSTREAM=$(git show upstream/main:product.json 2>/dev/null \
	| grep -A1 '"rstudio.rstudio-workbench"' | grep -oE --color=never '[0-9]{4}\.[0-9]+\.[0-9]+' | head -1 || true)

PWB_BEHIND=false
if [ -n "$PWB_MAIN" ] && [ -n "$PWB_UPSTREAM" ]; then
	# Positron is behind only if the highest of the two versions is upstream's.
	HIGHEST=$(printf '%s\n%s\n' "$PWB_MAIN" "$PWB_UPSTREAM" | sort -V | tail -1)
	if [ "$HIGHEST" = "$PWB_UPSTREAM" ] && [ "$PWB_MAIN" != "$PWB_UPSTREAM" ]; then
		PWB_BEHIND=true
	fi
fi

echo ""
echo "rstudio.rstudio-workbench: Positron=${PWB_MAIN:-?} upstream=${PWB_UPSTREAM:-?}"
if [ "$PWB_BEHIND" = true ]; then
	echo "Positron is BEHIND -- update-extension-* bumps ARE worth considering."
else
	echo "Positron is equal or ahead -- update-extension-* bumps are already covered; skip them."
	CANDIDATES=$(echo "$CANDIDATES" | grep -viE 'update-extension-' || true)
fi

echo ""
echo "Candidate merges to triage since ${BASELINE}:"
echo "============================================="
if [ -z "$CANDIDATES" ]; then
	echo "(none -- only baseline/tooling merges, nothing portable)"
	exit 0
fi
echo "$CANDIDATES"

echo ""
echo "Heads up: the candidates above are waiting upstream beyond the single PR"
echo "you named. version-bump and .github/Jenkins-only commits are vscode-server"
echo "tooling and are normally skipped. A PR may also already exist in Positron if"
echo "it was back-ported upstream (check direction before porting). Surface the"
echo "remaining portable source PRs to the user before porting only the one they"
echo "asked for."
