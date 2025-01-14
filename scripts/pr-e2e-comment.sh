#!/bin/bash

# Script to update or create a PR comment with E2E test tags
# Usage: ./update_pr_comment.sh "<comment_marker>" "<tags>"
# Example: ./update_pr_comment.sh "<!-- PR Tags -->" "@critical,@quarto"

set -e

# Arguments
COMMENT_MARKER="$1"  # e.g., "<!-- PR Tags -->"
TAGS="$2"            # e.g., "@critical,@quarto"

# Ensure required arguments are provided
if [ -z "$COMMENT_MARKER" ] || [ -z "$TAGS" ]; then
  echo "Usage: $0 \"<comment_marker>\" \"<tags>\""
  exit 1
fi

# Fetch GitHub repository and PR number from the environment
REPO="${GITHUB_REPOSITORY}"  # Automatically set by GitHub Actions
PR_NUMBER="${GITHUB_PR_NUMBER:-${GITHUB_EVENT_PULL_REQUEST_NUMBER}}"  # Use the correct PR number env variable
GITHUB_TOKEN="${GITHUB_TOKEN}"  # GitHub token for authentication

if [ -z "$PR_NUMBER" ]; then
  echo "Error: PR number not found in the environment. Ensure GITHUB_EVENT_PULL_REQUEST_NUMBER is set."
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN is not set. Ensure you provide a GitHub token for authentication."
  exit 1
fi

# Fetch existing comments on the PR
COMMENTS=$(gh api repos/${REPO}/issues/${PR_NUMBER}/comments --header "Authorization: token $GITHUB_TOKEN")

# Check if a comment with the marker already exists
COMMENT_ID=$(echo "$COMMENTS" | jq -r ".[] | select(.body | contains(\"$COMMENT_MARKER\")) | .id")

# Format the tags with individual backticks
FORMATTED_TAGS=$(echo "$TAGS" | sed 's/,/` `/g' | sed 's/^/`/' | sed 's/$/`/')

# Add the "🚨 RED ALERT!" note
RED_ALERT_NOTE="<!-- \n🚨 RED ALERT! ✋ Rule breaker detected! Tags don’t go here, they belong above ^ in the PR description using this proper format: \`@:tag\`. Changing them here won't do anything (trust us, we’ve tried). Confused? Check out the README hyperlink.\n-->"

# Build the new comment body with proper newlines
NEW_COMMENT=$(printf "${COMMENT_MARKER}\n${RED_ALERT_NOTE}\n\n**E2E Tests** 🚀\nThis PR will run tests tagged with: %s\n\n<sup>[readme](https://github.com/posit-dev/positron/blob/main/test/e2e/README.md#pull-requests-and-test-tags)</sup>&nbsp;&nbsp;<sup>[valid tags](https://github.com/posit-dev/positron/blob/main/test/e2e/infra/test-runner/test-tags.ts)</sup>" "$FORMATTED_TAGS")

if [ -n "$COMMENT_ID" ]; then
  # Update the existing comment
  echo "Updating existing comment (ID: $COMMENT_ID)..."
  gh api repos/${REPO}/issues/comments/$COMMENT_ID \
    -X PATCH \
    -F body="$NEW_COMMENT" \
    --header "Authorization: token $GITHUB_TOKEN"
else
  # Create a new comment
  echo "Creating a new comment..."
  gh api repos/${REPO}/issues/${PR_NUMBER}/comments \
    -F body="$NEW_COMMENT" \
    --header "Authorization: token $GITHUB_TOKEN"
fi
