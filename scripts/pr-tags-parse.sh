#!/bin/bash
# Script to parse tags from a GitHub Pull Request body
# Usage: bash parse-pr-tags.sh

set -e

# Pure tag-derivation helpers (unit-tested in scripts/test/pr-tags-lib-test.sh).
source "$(dirname "$0")/lib/pr-tags-lib.sh"

# Fetch GitHub repository and PR number from the environment
REPO="${GITHUB_REPOSITORY}"  # Automatically set by GitHub Actions
PR_NUMBER="${GITHUB_PR_NUMBER:-${GITHUB_EVENT_PULL_REQUEST_NUMBER}}"  # Use the correct PR number env variable
GITHUB_TOKEN="${GITHUB_TOKEN}"  # GitHub token for authentication

# Validate required environment variables
if [[ -z "$REPO" || -z "$PR_NUMBER" || -z "$GITHUB_TOKEN" ]]; then
	echo "Error: Missing required environment variables."
	echo "Ensure the following are set: GITHUB_REPOSITORY, GITHUB_PR_NUMBER or GITHUB_EVENT_PULL_REQUEST_NUMBER, GITHUB_TOKEN."
	exit 1
fi

# Fetch the PR body using the GitHub CLI
echo "Fetching PR body for ${REPO} #${PR_NUMBER}..."
PULL_REQUEST_BODY=$(gh api repos/${REPO}/pulls/${PR_NUMBER} --header "Authorization: token $GITHUB_TOKEN" --jq '.body')

# Handle empty PR body
if [[ -z "$PULL_REQUEST_BODY" ]]; then
	echo "Error: PR body is empty or could not be fetched."
	exit 1
fi

# Sanitize the PR BODY by stripping carriage returns (GitHub returns CRLF line
# endings), collapsing newlines to spaces, and escaping double quotes. Stripping
# CR first ensures a tag at end-of-line isn't immediately followed by a stray
# '\r', which would defeat the boundary checks below.
PR_BODY=$(echo "$PULL_REQUEST_BODY" | tr -d '\r' | tr '\n' ' ' | sed 's/"/\\"/g')

echo "Parsing tags from PR body..."

if echo "$PR_BODY" | grep -q "@:win"; then
	echo "Found win tag in PR body. Setting to run windows tests."
	echo "win_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:web"; then
	echo "Found web tag in PR body. Setting to run web tests."
	echo "web_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:rhel-electron"; then
	echo "Found RHEL electron tag in PR body. Setting to run RHEL electron tests."
	echo "rhel_electron_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:rhel-web"; then
	echo "Found RHEL web tag in PR body. Setting to run RHEL web tests."
	echo "rhel_web_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:suse-electron"; then
	echo "Found SUSE electron tag in PR body. Setting to run SUSE electron tests."
	echo "suse_electron_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:suse-web"; then
	echo "Found SUSE web tag in PR body. Setting to run SUSE web tests."
	echo "suse_web_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:sles-electron"; then
	echo "Found SLES electron tag in PR body. Setting to run SLES electron tests."
	echo "sles_electron_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:sles-web"; then
	echo "Found SLES web tag in PR body. Setting to run SLES web tests."
	echo "sles_web_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:debian-electron"; then
	echo "Found Debian electron tag in PR body. Setting to run Debian electron tests."
	echo "debian_electron_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:debian-web"; then
	echo "Found Debian web tag in PR body. Setting to run Debian web tests."
	echo "debian_web_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:pyrefly"; then
	echo "Found pyrefly tag in PR body. Setting to run pyrefly tests."
	echo "pyrefly_tag_found=true" >> "$GITHUB_OUTPUT"
fi
# Match a bare '@:workbench' tag but not longer variants like '@:workbench-stable'
# or '@:workbench-snowflake'. The tag must be followed by a non-tag character
# (anything outside [a-zA-Z0-9_-]) or the end of the string.
if echo "$PR_BODY" | grep -qE "@:workbench([^a-zA-Z0-9_-]|\$)"; then
	echo "Found workbench tag in PR body. Setting to run workbench tests."
	echo "workbench_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:publisher"; then
	echo "Found publisher tag in PR body. Enabling workbench tests so publisher tests can run."
	echo "workbench_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:workbench-stable"; then
	echo "Found workbench-stable tag in PR body. Setting to run workbench tests against the last stable Workbench."
	echo "workbench_stable_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:jupyter"; then
	echo "Found jupyter tag in PR body. Setting to run jupyter tests."
	echo "jupyter_tag_found=true" >> "$GITHUB_OUTPUT"
fi
if echo "$PR_BODY" | grep -q "@:remote-ssh"; then
	echo "Found remote-ssh tag in PR body. Setting to run remote-ssh tests."
	echo "remote_ssh_tag_found=true" >> "$GITHUB_OUTPUT"
fi

# Check if @:all is present in the PR body
if echo "$PR_BODY" | grep -q "@:all"; then
	echo "Found @:all tag in PR body. Setting tags to run all tests."
	TAGS="" # Set to an empty string to indicate all tests should run
else
	# Parse tags starting with '@:'
	TAGS=$(echo "$PR_BODY" | grep -o "@:[a-zA-Z0-9_-]*" | tr '\n' ',' | sed 's/,$//')

	# @:no-auto-tags is an opt-out signal (detected separately below), not a real
	# tag -- strip it so it never pollutes the grep string or the log line.
	TAGS=$(printf '%s' "$TAGS" | tr ',' '\n' | grep -v '^@:no-auto-tags$' | paste -sd, -)

	# Validate author-typed tags against the real TestTags enum. A typo (e.g.
	# @:consle) would otherwise silently become a dead --grep alternative that
	# matches nothing and gives no feedback -- and could even mask the no-match
	# warning below (TAGS != "@:critical" even though nothing extra actually
	# ran). Drop invalid tags and surface them so the PR comment can warn.
	ENUM_FILE="$(dirname "$0")/../test/e2e/infra/test-runner/test-tags.ts"
	INVALID_TAGS=""
	if [[ -n "$TAGS" && -f "$ENUM_FILE" ]]; then
		IFS='|' read -r TAGS INVALID_TAGS <<< "$(split_valid_invalid_tags "$TAGS" "$ENUM_FILE")"
		if [[ -n "$INVALID_TAGS" ]]; then
			echo "Warning: unrecognized tag(s) in PR description, ignoring: $INVALID_TAGS"
		fi
	fi
	echo "invalid_tags=$INVALID_TAGS" >> "$GITHUB_OUTPUT"

	# Always add @:critical if not already included
	if [[ ! "$TAGS" =~ "@:critical" ]]; then
		if [[ -n "$TAGS" ]]; then
			TAGS="@:critical,$TAGS"
		else
			TAGS="@:critical"
		fi
	fi

	# Auto-inject @:ark when the ark submodule is bumped.
	# extensions/positron-r/ark is a gitlink (submodule pointer); it appears
	# as a single filename entry in the PR files API when the pointer changes.
	CHANGED_FILES=$(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate \
		--header "Authorization: token $GITHUB_TOKEN" \
		--jq '.[].filename' || true)
	if [[ -z "$CHANGED_FILES" ]]; then
		echo "Warning: could not fetch changed files; skipping @:ark injection."
	elif echo "$CHANGED_FILES" | grep -qxF "extensions/positron-r/ark"; then
		echo "Ark submodule changed. Injecting @:ark tag."
		if [[ -n "$TAGS" ]]; then
			TAGS="$TAGS,@:ark"
		else
			TAGS="@:ark"
		fi
	fi

	# Resolve the path to the map (this script lives in scripts/).
	SCRIPT_DIR="$(dirname "$0")"
	MAP_FILE="$SCRIPT_DIR/../.github/workflows/e2e-tag-paths-map.json"

	# Auto-inject feature tags derived from the PR's changed SOURCE files, unless
	# the author opted out with @:no-auto-tags. Additive only -- never removes
	# tags the author specified. Derivation is scoped to the source/extension
	# PATH map: it targets the population that under-tags (devs fixing code who
	# may not know which e2e suite covers it). Test-file changes are NOT
	# auto-tagged -- those are almost always authored by QA, who tag deliberately,
	# and deriving every feature tag off a multi-tagged test file over-selected
	# whole sibling suites for no coverage gain on the impacted test.
	if echo "$PR_BODY" | grep -q "@:no-auto-tags"; then
		echo "Found @:no-auto-tags. Skipping derived tagging."
	elif [[ -n "$CHANGED_FILES" && -f "$MAP_FILE" ]]; then
		MAP_TAGS="$(derive_map_tags "$CHANGED_FILES" "$MAP_FILE")"
		if [[ -n "$MAP_TAGS" ]]; then
			echo "Derived tags from changed source files: $MAP_TAGS"
			TAGS="$(union_csv_tags "$TAGS" "$MAP_TAGS")"
		fi
	fi

	# Enable Windows/web jobs when a NEWLY ADDED e2e test carries tags.WIN /
	# tags.WEB (read from added diff lines only, so small edits to an existing
	# tagged test don't opt in). Runs regardless of @:no-auto-tags.
	TEST_PATCHES="$(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate \
		--header "Authorization: token $GITHUB_TOKEN" \
		--jq '.[] | select(.filename | startswith("test/e2e/tests/")) | .patch' || true)"
	read -r ADDED_WIN ADDED_WEB <<< "$(scan_added_platform_tags "$TEST_PATCHES")"
	if [[ "$ADDED_WIN" == "true" ]]; then
		echo "Newly added e2e test carries tags.WIN. Enabling Windows tests."
		echo "win_tag_found=true" >> "$GITHUB_OUTPUT"
	fi
	if [[ "$ADDED_WEB" == "true" ]]; then
		echo "Newly added e2e test carries tags.WEB. Enabling web tests."
		echo "web_tag_found=true" >> "$GITHUB_OUTPUT"
	fi

	# Output the tags
	echo "Extracted Tags: $TAGS"

	# Signal the workflow when nothing but the @:critical floor resolved, so it
	# can warn the author that no feature suites were auto-selected.
	if [[ "$TAGS" == "@:critical" ]]; then
		echo "no_matches=true" >> "$GITHUB_OUTPUT"
	else
		echo "no_matches=false" >> "$GITHUB_OUTPUT"
	fi
fi

# PR-time guardrail: warn (via the advisory comment + log) when this PR touches
# a Positron source dir/extension with no map entry. Runs for BOTH @:all and
# the normal path -- it is map-maintenance feedback, independent of tag
# selection. Reuse CHANGED_FILES/MAP_FILE from the else branch above if they
# were already computed there, so we don't double-fetch.
# Reuse SCRIPT_DIR/CHANGED_FILES if the else branch already set them; the @:all
# branch skips that branch, so fall back to computing them here.
SCRIPT_DIR="${SCRIPT_DIR:-$(dirname "$0")}"
MAP_FILE="${MAP_FILE:-$SCRIPT_DIR/../.github/workflows/e2e-tag-paths-map.json}"
if [[ -z "${CHANGED_FILES+x}" ]]; then
	CHANGED_FILES=$(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate \
		--header "Authorization: token $GITHUB_TOKEN" \
		--jq '.[].filename' || true)
fi

UNMAPPED_DIRS=""
if [[ -n "$CHANGED_FILES" && -f "$MAP_FILE" ]]; then
	UNMAPPED_DIRS="$(find_unmapped_positron_dirs "$CHANGED_FILES" "$MAP_FILE")"
	if [[ -n "$UNMAPPED_DIRS" ]]; then
		echo "Unmapped Positron dirs touched by this PR (add to e2e-tag-paths-map.json):"
		while IFS= read -r d; do [[ -n "$d" ]] && printf '  - %s\n' "$d"; done <<< "$UNMAPPED_DIRS"
	fi
fi
echo "unmapped_dirs=$(printf '%s' "$UNMAPPED_DIRS" | paste -sd, -)" >> "$GITHUB_OUTPUT"

# De-duplicate the final tag list (order-stable). Author tags, the @:critical
# floor, the @:ark submodule injection, and derived map tags can overlap (e.g. a
# PR that both bumps the ark submodule and is authored with @:ark); union with an
# empty list collapses any repeats so neither the --grep nor the PR comment shows
# a tag twice.
TAGS="$(union_csv_tags "$TAGS" "")"

# Save tags to GITHUB_OUTPUT for use in GitHub Actions
if [[ -n "$GITHUB_OUTPUT" ]]; then
	echo "tags=$TAGS" >> "$GITHUB_OUTPUT"
else
	echo "Warning: GITHUB_OUTPUT is not set. Tags will not be available to the workflow."
fi
