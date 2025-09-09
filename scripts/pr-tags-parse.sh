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

# Sanitize the PR BODY by removing newlines and escaping double quotes
PR_BODY=$(echo "$PULL_REQUEST_BODY" | tr '\n' ' ' | sed 's/"/\\"/g')

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

	# Output the tags
	echo "Extracted Tags: $TAGS"
fi

# Save tags to GITHUB_OUTPUT for use in GitHub Actions
if [[ -n "$GITHUB_OUTPUT" ]]; then
  echo "tags=$TAGS" >> "$GITHUB_OUTPUT"
else
  echo "Warning: GITHUB_OUTPUT is not set. Tags will not be available to the workflow."
fi
