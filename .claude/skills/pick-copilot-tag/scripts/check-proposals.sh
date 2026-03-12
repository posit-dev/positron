#!/usr/bin/env bash
# Check upstream release tags for API proposal compatibility with a Positron build.
#
# Usage:
#   ./check-proposals.sh                              # auto-detect from repo
#   ./check-proposals.sh <proposals-source>            # auto-discover tags
#   ./check-proposals.sh <proposals-source> <tag-prefix>  # explicit tag series
#
# With no arguments, reads package.json for the Code OSS version, extracts
# proposals from the source tree, and discovers compatible tag series
# automatically.
#
# Options:
#   -v, --verbose   Show full list of Positron proposals (default: count only)
#
# Requires: gh, python3

set -euo pipefail

REPO="microsoft/vscode-copilot-chat"
PROPOSALS_TS="src/vs/platform/extensions/common/extensionsApiProposals.ts"
VERBOSE=false

die() { echo "error: $*" >&2; exit 1; }

# --- Parse flags ---------------------------------------------------------------

args=()
for arg in "$@"; do
	case "$arg" in
		-v|--verbose) VERBOSE=true ;;
		*) args+=("$arg") ;;
	esac
done
set -- "${args[@]+${args[@]}}"

# --- Resolve Positron proposals ------------------------------------------------

resolve_proposals() {
	local source="$1"

	if [[ -d "$source" || "$source" == *.app ]]; then
		# It's a Positron app bundle -- extract from sharedProcessMain.js
		local js
		js=$(find "$source" -name 'sharedProcessMain.js' -print -quit 2>/dev/null)
		[[ -n "$js" ]] || die "Could not find sharedProcessMain.js inside $source"
		# Extract name@version from the proposals map structure (minified:
		# name:{proposal:"...",version:N} )
		python3 -c "
import re, sys
content = open(sys.argv[1]).read()
for m in re.finditer(r'(\w+):\{proposal:\"[^\"]+\",version:(\d+)\}', content):
    print(f'{m.group(1)}@{m.group(2)}')
" "$js" | sort -u
	elif [[ -f "$source" && "$source" == *.ts ]]; then
		# TypeScript source file (extensionsApiProposals.ts)
		python3 -c "
import re, sys
content = open(sys.argv[1]).read()
for m in re.finditer(r'(\w+)\s*:\s*\{[^}]*version\s*:\s*(\d+)', content):
    print(f'{m.group(1)}@{m.group(2)}')
" "$source" | sort -u
	elif [[ -f "$source" ]]; then
		# Plain text file (one proposal@version per line)
		grep -vE '^\s*(#|$)' "$source" | sort -u
	else
		die "Not a file or directory: $source"
	fi
}

# --- Discover compatible tag series from Code OSS version ---------------------

discover_tag_series() {
	local code_oss_version="$1"
	local code_oss_minor
	code_oss_minor=$(echo "$code_oss_version" | cut -d. -f2)

	echo "Code OSS version: $code_oss_version"

	# List all unique tag series (check last 5 minor versions)
	local all_series
	all_series=$(gh api "repos/$REPO/git/matching-refs/tags/v" --paginate \
		--jq '.[].ref | ltrimstr("refs/tags/")' \
		| grep -oE '^v[0-9]+\.[0-9]+' | sort -uV | tail -5)

	[[ -n "$all_series" ]] || die "Could not list tag series from $REPO"

	echo "Checking recent tag series for engine compatibility:"
	local candidates=""
	for series in $all_series; do
		local engine
		engine=$(gh api "repos/$REPO/contents/package.json?ref=${series}.0" \
			--jq '.content' 2>/dev/null \
			| base64 -d \
			| python3 -c "
import sys, json
pkg = json.load(sys.stdin)
print(pkg.get('engines', {}).get('vscode', 'unknown'))
" 2>/dev/null) || continue

		# Parse engine minor version from e.g. ^1.109.0
		local engine_minor
		engine_minor=$(echo "$engine" | grep -oE '[0-9]+\.[0-9]+' | head -1 | cut -d. -f2)
		[[ -n "$engine_minor" ]] || continue

		if [[ "$engine_minor" -le "$code_oss_minor" ]]; then
			echo "  $series -> $engine (compatible)"
			candidates+="$series"$'\n'
		else
			echo "  $series -> $engine (needs Code OSS > $code_oss_version)"
		fi
	done

	# Return candidates newest-first so _LATEST_OK picks the highest series.
	_CANDIDATES=$(echo "$candidates" | grep -v '^$' | sort -rV || true)
}

# --- Check a single tag series ------------------------------------------------

check_series() {
	local tag_prefix="$1"
	local positron_proposals="$2"

	echo ""
	echo "--- $tag_prefix ---"

	local tags
	tags=$(gh api "repos/$REPO/git/matching-refs/tags/$tag_prefix." \
		--jq '.[].ref | ltrimstr("refs/tags/")' \
		| grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
		| sort -rV)

	[[ -n "$tags" ]] || { echo "No tags found matching $tag_prefix.*"; return; }

	for tag in $tags; do
		local ext_proposals
		ext_proposals=$(gh api "repos/$REPO/contents/package.json?ref=$tag" \
			--jq '.content' | base64 -d | python3 -c "
import sys, json
pkg = json.load(sys.stdin)
for p in sorted(p for p in pkg.get('enabledApiProposals', []) if '@' in p):
    print(p)
")

		local issues=""
		while IFS= read -r prop; do
			[[ -z "$prop" ]] && continue
			if ! echo "$positron_proposals" | grep -qxF "$prop"; then
				local name="${prop%%@*}"
				local match
				match=$(echo "$positron_proposals" | grep -E "^${name}@" || true)
				if [[ -n "$match" ]]; then
					issues+="   $prop (Positron has $match)"$'\n'
				else
					issues+="   $prop (not in Positron)"$'\n'
				fi
			fi
		done <<< "$ext_proposals"

		if [[ -z "$issues" ]]; then
			echo "OK  $tag"
			# First OK is the latest compatible (tags are sorted newest-first)
			if [[ -z "$_LATEST_OK" ]]; then
				_LATEST_OK="$tag"
			fi
			return
		else
			echo "BAD $tag"
			printf '%s' "$issues"
		fi
	done

	echo "(no compatible tags in $tag_prefix series)"
}

# --- Main ---------------------------------------------------------------------
# Globals set by functions:
#   _CANDIDATES  - newline-separated tag series (set by discover_tag_series)
#   _LATEST_OK   - highest compatible tag found (set by check_series)

PROPOSALS_SOURCE="${1:-}"
TAG_PREFIX="${2:-}"
_LATEST_OK=""

# Default proposals source to the TypeScript file in the repo
if [[ -z "$PROPOSALS_SOURCE" ]]; then
	[[ -f "$PROPOSALS_TS" ]] || die "No proposals source given and $PROPOSALS_TS not found. Run from the Positron repo root or pass an explicit path."
	PROPOSALS_SOURCE="$PROPOSALS_TS"
fi

positron_proposals=$(resolve_proposals "$PROPOSALS_SOURCE")
proposal_count=$(echo "$positron_proposals" | wc -l | tr -d ' ')

if [[ "$VERBOSE" == true ]]; then
	echo "Positron proposals ($proposal_count versioned, from $PROPOSALS_SOURCE):"
	echo "$positron_proposals" | sed 's/^/  /'
else
	echo "Positron proposals: $proposal_count versioned (from $PROPOSALS_SOURCE)"
fi
echo ""

if [[ -n "$TAG_PREFIX" ]]; then
	# Explicit tag prefix -- check just that series
	check_series "$TAG_PREFIX" "$positron_proposals"
else
	# Auto-discover compatible series from package.json
	[[ -f "package.json" ]] || die "No tag prefix given and no package.json found. Run from the Positron repo root or pass an explicit tag prefix."
	code_oss_version=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")

	discover_tag_series "$code_oss_version"
	[[ -n "$_CANDIDATES" ]] || die "No compatible tag series found for Code OSS $code_oss_version"

	for series in $_CANDIDATES; do
		check_series "$series" "$positron_proposals"
	done
fi

# --- Summary ------------------------------------------------------------------

echo ""
if [[ -n "$_LATEST_OK" ]]; then
	echo "Latest compatible: $_LATEST_OK"
else
	echo "No compatible tags found."
fi
