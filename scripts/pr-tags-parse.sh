#!/bin/bash
# Usage:
# bash parse-pr-tags.sh "<PULL_REQUEST_BODY>"
# Example:
# bash parse-pr-tags.sh "This is a PR..."

# Input: PULL_REQUEST_BODY
PULL_REQUEST_BODY="$1"

# Sanitize the PR BODY by removing newlines and escaping double quotes
PR_BODY=$(echo "$PULL_REQUEST_BODY" | tr '\n' ' ' | sed 's/"/\\"/g')

echo "Parsing tags from PR body..."

# Check if @:all is present in the PR body
if echo "$PR_BODY" | grep -q "@:all"; then
  echo "Found @:all tag in PR body. Setting tags to run all tests."
  TAGS="" # Set to an empty string to indicate all tests should run
else
  # Parse tags starting with '@:' and convert to '@'
  TAGS=$(echo "$PR_BODY" | grep -o "@:[a-zA-Z0-9_-]*" | sed 's/@://g' | sed 's/^/@/' | tr '\n' ',' | sed 's/,$//')

  # Always add @critical if not already included
  if [[ ! "$TAGS" =~ "@critical" ]]; then
    if [[ -n "$TAGS" ]]; then
      TAGS="@critical,$TAGS"
    else
      TAGS="@critical"
    fi
  fi
fi

# Output the tags
echo "Extracted Tags: $TAGS"

# Save tags to GITHUB_OUTPUT for use in GitHub Actions
if [[ -n "$GITHUB_OUTPUT" ]]; then
  echo "tags=$TAGS" >> "$GITHUB_OUTPUT"
else
  echo "Warning: GITHUB_OUTPUT is not set. Tags will not be available to the workflow."
fi
