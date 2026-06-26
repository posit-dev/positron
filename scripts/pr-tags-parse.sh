#!/bin/bash
# Script to parse tags from a GitHub Pull Request body
# Usage: bash parse-pr-tags.sh

set -e

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

	# Output the tags
	echo "Extracted Tags: $TAGS"
fi

# Save tags to GITHUB_OUTPUT for use in GitHub Actions
if [[ -n "$GITHUB_OUTPUT" ]]; then
	echo "tags=$TAGS" >> "$GITHUB_OUTPUT"
else
	echo "Warning: GITHUB_OUTPUT is not set. Tags will not be available to the workflow."
fi
