#!/usr/bin/env bash
# Check upstream release tags for API proposal compatibility with a Positron build.
#
# Usage:
#   ./check-proposals.sh                              # auto-detect from repo
#   ./check-proposals.sh <proposals-source>            # auto-discover tags
#   ./check-proposals.sh <proposals-source> <tag-prefix>  # explicit tag series
#   ./check-proposals.sh --positron-version 2026.03.0  # check against a release
#   ./check-proposals.sh --positron-version 2026.03.0 v0.37  # release + explicit series
#
# With no arguments, reads package.json for the Code OSS version, extracts
# proposals from the source tree, and discovers compatible tag series
# automatically.
#
# Options:
#   -v, --verbose                    Show full list of Positron proposals (default: count only)
#   --pre-releases                   Also check date-based pre-release tags (default: releases only)
#   --positron-version <version>     Check against a Positron release (e.g. 2026.03.0)
#                                    Looks up the release tag on GitHub, retrieves the
#                                    Code OSS version and proposals from that build.
#
# Requires: gh, python3

set -euo pipefail

REPO="microsoft/vscode-copilot-chat"
PROPOSALS_TS="src/vs/platform/extensions/common/extensionsApiProposals.ts"
POSITRON_REPO="posit-dev/positron"
VERBOSE=false
PRE_RELEASES=false
POSITRON_VERSION=""

die() { echo "error: $*" >&2; exit 1; }

# --- Parse flags ---------------------------------------------------------------

args=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		-v|--verbose) VERBOSE=true; shift ;;
		--pre-releases) PRE_RELEASES=true; shift ;;
		--positron-version)
			[[ -n "${2:-}" ]] || die "--positron-version requires a version (e.g. 2026.03.0)"
			POSITRON_VERSION="$2"; shift 2 ;;
		*) args+=("$1"); shift ;;
	esac
done
set -- "${args[@]+${args[@]}}"

# --- Resolve Positron release tag ---------------------------------------------
# Given a Positron version (e.g. 2026.03.0 or 2026.03.0-212), find the
# published release tag on GitHub and extract its Code OSS version.
# Sets: _POSITRON_TAG, _POSITRON_CODE_VERSION

resolve_positron_version() {
	local version="$1"

	# If the version already includes a build number, use it directly.
	# Otherwise, find the latest published release matching the prefix.
	local tag
	if [[ "$version" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]+-[0-9]+$ ]]; then
		tag="$version"
	elif [[ "$version" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]+$ ]]; then
		tag=$(gh api "repos/$POSITRON_REPO/releases" --paginate \
			--jq ".[].tag_name | select(startswith(\"$version-\"))" \
			| sort -t- -k2 -rn | head -1)
		[[ -n "$tag" ]] || die "No published release found for Positron $version"
	else
		die "--positron-version must be YYYY.MM.PATCH or YYYY.MM.PATCH-BUILD (e.g. 2026.03.0), got: $version"
	fi

	echo "Positron release: $tag"

	# Fetch Code OSS version from that tag's package.json
	local pkg_content
	pkg_content=$(gh api "repos/$POSITRON_REPO/contents/package.json?ref=$tag" \
		--jq '.content' 2>/dev/null) || die "Could not fetch package.json from $POSITRON_REPO at tag $tag"
	[[ -n "$pkg_content" ]] || die "Empty package.json content from $POSITRON_REPO at tag $tag"

	_POSITRON_TAG="$tag"
	_POSITRON_CODE_VERSION=$(echo "$pkg_content" | base64 -d | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
	echo "Code OSS version: $_POSITRON_CODE_VERSION"
}

# --- Resolve Positron proposals ------------------------------------------------

# Fetch proposals from a remote Positron tag on GitHub.
resolve_proposals_from_tag() {
	local tag="$1"
	local content
	content=$(gh api "repos/$POSITRON_REPO/contents/$PROPOSALS_TS?ref=$tag" \
		--jq '.content' 2>/dev/null) || die "Could not fetch $PROPOSALS_TS from $POSITRON_REPO at tag $tag"
	[[ -n "$content" ]] || die "Empty proposals file from $POSITRON_REPO at tag $tag"

	echo "$content" | base64 -d | python3 -c "
import re, sys
content = sys.stdin.read()
for m in re.finditer(r'(\w+)\s*:\s*\{[^}]*version\s*:\s*(\d+)', content):
    print(f'{m.group(1)}@{m.group(2)}')
" | sort -u
}

resolve_proposals() {
	local source="$1"

	if [[ -d "$source" || "$source" == *.app ]]; then
		# It's a Positron app bundle -- extract from sharedProcessMain.js
		local js
		js=$(find "$source" -name 'sharedProcessMain.js' -print -quit 2>/dev/null)
		[[ -n "$js" ]] || die "Could not find sharedProcessMain.js inside $source"
		# Extract name@version from the proposals map structure. The JS may
		# be minified (name:{proposal:"...",version:N}) or pretty-printed
		# with newlines and indentation, so allow optional whitespace.
		python3 -c "
import re, sys
content = open(sys.argv[1]).read()
for m in re.finditer(r'(\w+):\s*\{\s*proposal:\s*\"[^\"]+\"\s*,\s*version:\s*(\d+)\s*\}', content):
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

	# List all unique tag series (check last 5 minor versions)
	local all_series
	all_series=$(gh api "repos/$REPO/git/matching-refs/tags/v" --paginate \
		--jq '.[].ref | ltrimstr("refs/tags/")' \
		| grep -oE '^v[0-9]+\.[0-9]+' | sort -uV | tail -5)

	[[ -n "$all_series" ]] || die "Could not list tag series from $REPO"

	echo "Checking recent tag series for engine compatibility:"
	local candidates=""
	for series in $all_series; do
		local content
		content=$(gh api "repos/$REPO/contents/package.json?ref=${series}.0" \
			--jq '.content' 2>/dev/null) || continue
		[[ -n "$content" ]] || continue

		local engine
		engine=$(echo "$content" | base64 -d 2>/dev/null | python3 -c "
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
		elif [[ "$engine_minor" -le "$((code_oss_minor + 1))" ]]; then
			# The .0 release needs a newer engine, but date-based pre-releases
			# in this series may target an older engine (they predate .0).
			echo "  $series -> $engine (pre-releases may be compatible)"
			candidates+="$series"$'\n'
		else
			local min_version
			min_version=$(echo "$engine" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
			echo "  $series -> $engine (needs Code OSS >= ${min_version:-$engine})"
		fi
	done

	# Return candidates newest-first so we check the highest series first.
	_CANDIDATES=$(echo "$candidates" | grep -v '^$' | sort -rV || true)
}

# --- Check a list of tags ----------------------------------------------------
# Sets _FOUND_OK to the first (newest) compatible tag, or "" if none found.

check_tag_list() {
	local tags="$1"
	local positron_proposals="$2"
	_FOUND_OK=""

	local total checked=0
	total=$(echo "$tags" | wc -l | tr -d ' ')

	# Progress indicator (only when stderr is a terminal).
	local show_progress=false
	[[ -t 2 ]] && show_progress=true
	_progress() {
		if [[ "$show_progress" == true ]]; then
			printf '\r\033[K  checking %d/%d: %s ...' "$@" >&2
		fi
	}
	_clear_progress() {
		if [[ "$show_progress" == true ]]; then
			printf '\r\033[K' >&2
		fi
	}

	# Track consecutive skips to print a summary instead of one line per tag.
	local skip_count=0 skip_first="" skip_last="" skip_reason=""
	_flush_skips() {
		if [[ "$skip_count" -eq 0 ]]; then return; fi
		_clear_progress
		if [[ "$skip_count" -eq 1 ]]; then
			echo "SKIP $skip_first ($skip_reason)"
		else
			echo "SKIP $skip_first .. $skip_last ($skip_count tags, $skip_reason)"
		fi
		skip_count=0 skip_first="" skip_last="" skip_reason=""
	}

	for tag in $tags; do
		checked=$((checked + 1))
		_progress "$checked" "$total" "$tag"

		local content
		content=$(gh api "repos/$REPO/contents/package.json?ref=$tag" \
			--jq '.content' 2>/dev/null) || continue
		[[ -n "$content" ]] || continue

		# Parse engine and proposals in one shot
		local parsed
		parsed=$(echo "$content" | base64 -d 2>/dev/null | python3 -c "
import sys, json, re
pkg = json.load(sys.stdin)
engine = pkg.get('engines', {}).get('vscode', '')
m = re.search(r'(\d+)\.(\d+)', engine)
print(m.group(2) if m else '')
print(engine)
for p in sorted(p for p in pkg.get('enabledApiProposals', []) if '@' in p):
    print(p)
" 2>/dev/null) || continue

		local tag_engine_minor tag_engine ext_proposals
		tag_engine_minor=$(echo "$parsed" | sed -n '1p')
		tag_engine=$(echo "$parsed" | sed -n '2p')
		ext_proposals=$(echo "$parsed" | tail -n +3)

		# Check per-tag engine compatibility
		if [[ -n "$_CODE_OSS_MINOR" && -n "$tag_engine_minor" \
				&& "$tag_engine_minor" -gt "$_CODE_OSS_MINOR" ]]; then
			local min_v
			min_v=$(echo "$tag_engine" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
			skip_count=$((skip_count + 1))
			[[ -z "$skip_first" ]] && skip_first="$tag"
			skip_last="$tag"
			skip_reason="needs Code OSS >= ${min_v:-$tag_engine}"
			continue
		fi

		# Flush any accumulated skips before printing a non-skip result
		_flush_skips
		_clear_progress

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
			_FOUND_OK="$tag"
			_clear_progress
			return
		else
			echo "BAD $tag"
			printf '%s' "$issues"
		fi
	done

	_flush_skips
	_clear_progress
}

# --- Check a single tag series ------------------------------------------------

check_series() {
	local tag_prefix="$1"
	local positron_proposals="$2"

	echo ""
	echo "--- $tag_prefix ---"

	local all_tags
	all_tags=$(gh api "repos/$REPO/git/matching-refs/tags/$tag_prefix." --paginate \
		--jq '.[].ref | ltrimstr("refs/tags/")' \
		| grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
		| sort -rV)

	[[ -n "$all_tags" ]] || { echo "No tags found matching $tag_prefix.*"; return; }

	# Separate semver releases (1-3 digit patch) from date-based pre-releases (4+ digits)
	local release_tags prerelease_tags
	release_tags=$(echo "$all_tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]{1,3}$' || true)
	prerelease_tags=$(echo "$all_tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]{4,}$' || true)

	if [[ -n "$release_tags" ]]; then
		local count
		count=$(echo "$release_tags" | wc -l | tr -d ' ')
		echo "Releases ($count tags):"
		check_tag_list "$release_tags" "$positron_proposals"
		if [[ -n "$_FOUND_OK" && -z "$_LATEST_OK" ]]; then
			_LATEST_OK="$_FOUND_OK"
		fi
	fi

	if [[ -n "$prerelease_tags" && "$PRE_RELEASES" == true ]]; then
		local count
		count=$(echo "$prerelease_tags" | wc -l | tr -d ' ')
		echo "Pre-releases ($count tags):"
		check_tag_list "$prerelease_tags" "$positron_proposals"
		if [[ -n "$_FOUND_OK" && -z "$_LATEST_PRERELEASE" ]]; then
			_LATEST_PRERELEASE="$_FOUND_OK"
		fi
	elif [[ -n "$prerelease_tags" ]]; then
		local count
		count=$(echo "$prerelease_tags" | wc -l | tr -d ' ')
		echo "Pre-releases ($count tags, skipped -- use --pre-releases to check)"
	fi
}

# --- Main ---------------------------------------------------------------------
# Globals set by functions:
#   _CANDIDATES        - newline-separated tag series (set by discover_tag_series)
#   _CODE_OSS_MINOR    - Code OSS minor version for per-tag engine checks
#   _LATEST_OK         - highest compatible release tag (set by check_series)
#   _LATEST_PRERELEASE - highest compatible pre-release tag (set by check_series)

_CODE_OSS_MINOR=""
_LATEST_OK=""
_LATEST_PRERELEASE=""

# When --positron-version is given, the only positional arg (if any) is a tag
# prefix to select a specific series. Otherwise, positionals are
# [proposals-source [tag-prefix]].
if [[ -n "$POSITRON_VERSION" ]]; then
	[[ $# -le 1 ]] || die "--positron-version accepts at most one positional argument (tag prefix), got $#"
	PROPOSALS_SOURCE=""
	TAG_PREFIX="${1:-}"
	resolve_positron_version "$POSITRON_VERSION"
	code_oss_version="$_POSITRON_CODE_VERSION"
	_CODE_OSS_MINOR=$(echo "$code_oss_version" | cut -d. -f2)
	positron_proposals=$(resolve_proposals_from_tag "$_POSITRON_TAG")
	proposals_label="$POSITRON_REPO@$_POSITRON_TAG"
else
	PROPOSALS_SOURCE="${1:-}"
	TAG_PREFIX="${2:-}"
	# Default proposals source to the TypeScript file in the repo
	if [[ -z "$PROPOSALS_SOURCE" ]]; then
		[[ -f "$PROPOSALS_TS" ]] || die "No proposals source given and $PROPOSALS_TS not found. Run from the Positron repo root or pass an explicit path."
		PROPOSALS_SOURCE="$PROPOSALS_TS"
	fi
	positron_proposals=$(resolve_proposals "$PROPOSALS_SOURCE")
	proposals_label="$PROPOSALS_SOURCE"
fi

proposal_count=$(echo "$positron_proposals" | wc -l | tr -d ' ')

if [[ "$VERBOSE" == true ]]; then
	echo "Positron proposals ($proposal_count versioned, from $proposals_label):"
	echo "$positron_proposals" | sed 's/^/  /'
else
	echo "Positron proposals: $proposal_count versioned (from $proposals_label)"
fi
echo ""

if [[ -n "$TAG_PREFIX" ]]; then
	# Try to get Code OSS version for per-tag engine checking
	if [[ -z "$_CODE_OSS_MINOR" && -f "package.json" ]]; then
		local_version=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null) || true
		_CODE_OSS_MINOR=$(echo "$local_version" | cut -d. -f2)
	fi
	# Explicit tag prefix -- check just that series
	check_series "$TAG_PREFIX" "$positron_proposals"
else
	# Determine Code OSS version (if not already set by --positron-version)
	if [[ -z "$_CODE_OSS_MINOR" ]]; then
		if [[ -f "package.json" ]]; then
			code_oss_version=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
		else
			die "No tag prefix given and no package.json found. Run from the Positron repo root, pass --positron-version, or pass an explicit tag prefix."
		fi
		_CODE_OSS_MINOR=$(echo "$code_oss_version" | cut -d. -f2)
		echo "Code OSS version: $code_oss_version"
	fi
	discover_tag_series "$code_oss_version"
	[[ -n "$_CANDIDATES" ]] || die "No compatible tag series found for Code OSS $code_oss_version"

	for series in $_CANDIDATES; do
		check_series "$series" "$positron_proposals"
		# Stop checking lower series once we find a compatible release.
		# Pre-releases alone don't stop the search -- we prefer releases.
		if [[ -n "$_LATEST_OK" ]]; then
			break
		fi
	done
fi

# --- Summary ------------------------------------------------------------------

echo ""
if [[ -n "$_LATEST_OK" ]]; then
	echo "Latest compatible release: $_LATEST_OK"
	if [[ -n "$_LATEST_PRERELEASE" ]]; then
		echo "Latest compatible pre-release: $_LATEST_PRERELEASE"
	fi
elif [[ -n "$_LATEST_PRERELEASE" ]]; then
	echo "Latest compatible (pre-release only): $_LATEST_PRERELEASE"
else
	echo "No compatible tags found."
fi
