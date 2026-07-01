#!/bin/bash

# Script to update or create the single E2E PR comment: the tags that will run,
# plus advisory warnings (no feature tags auto-selected, and/or touched Positron
# dirs missing from the tag map) folded into the same comment.
# Usage: bash ./scripts/pr-e2e-comment.sh "<comment_marker>" "<tags>" [<no_matches>] [<unmapped_dirs>]
# Example: bash ./scripts/pr-e2e-comment.sh "<!-- PR Tags -->" "@:critical,@:quarto" "false" ""

set -e

# Arguments
COMMENT_MARKER="$1"        # e.g., "<!-- PR Tags -->"
TAGS="$2"                  # e.g., "@:critical,@:quarto"
NO_MATCHES="${3:-false}"   # "true" when only @:critical resolved (no feature tags)
UNMAPPED_DIRS="${4:-}"     # comma-joined Positron dirs with no entry in the tag map

# Pure helpers (is_infra_only) used to gate the advisory warnings.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/pr-tags-lib.sh"

# Ensure required arguments are provided
if [ -z "$COMMENT_MARKER" ]; then
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

# Format the tags with individual backticks, or use default
if [ -z "$TAGS" ]; then
  FORMATTED_TAGS="\`@:all\`"
else
  FORMATTED_TAGS=$(echo "$TAGS" | sed 's/,/` `/g' | sed 's/^/`/' | sed 's/$/`/')
fi

# Add the "🚨 RED ALERT!" note
RED_ALERT_NOTE="<!-- \n🚨 RED ALERT! ✋ Rule breaker detected! Tags don’t go here, they belong above ^ in the PR description using this proper format: \`@:tag\`. Changing them here won't do anything (trust us, we’ve tried). Confused? Check out the README hyperlink.\n-->"

# Advisory warnings, folded into this single comment. Suppressed for infra-only
# PRs (docs/scripts/config), where feature e2e coverage isn't expected, so the
# warnings would just be noise. Rebuilt every run, so they clear on a push that
# resolves them.
WARN_FMT=""
CHANGED_FILES="$(gh api repos/${REPO}/pulls/${PR_NUMBER}/files --paginate --header "Authorization: token $GITHUB_TOKEN" --jq '.[].filename' || true)"
if [ "$(is_infra_only "$CHANGED_FILES")" != "true" ]; then
  if [ "$NO_MATCHES" = "true" ]; then
    # Info, not warning: only-critical is common and often benign (refactors,
    # infra, test-only PRs), so a louder style would just be noise.
    WARN_FMT="${WARN_FMT}\n\n> [!NOTE]\n> No feature tags detected. If this PR needs feature coverage, add the tag above and retrigger the workflow (a description edit won't)."
  fi
  if [ -n "$UNMAPPED_DIRS" ]; then
    # Warning: a missing map entry is a concrete, fixable gap -- until it's added,
    # every future PR touching this dir silently won't auto-tag.
    DIRS="$(echo "$UNMAPPED_DIRS" | sed 's/,/, /g')"
    WARN_FMT="${WARN_FMT}\n\n> [!WARNING]\n> Touches Positron dir(s) not in \`e2e-tag-paths-map.json\`: ${DIRS}. Add each (a tag, or \`[]\` for no coverage) so future changes auto-tag."
  fi
fi

# Build the new comment body with proper newlines (%s = tags, %b = warnings).
NEW_COMMENT=$(printf "${COMMENT_MARKER}\n${RED_ALERT_NOTE}\n\n**E2E Tests** 🚀\nThis PR will run tests tagged with: %s\n\n<sup>[readme](https://github.com/posit-dev/positron/blob/main/test/e2e/README.md#pull-requests-and-test-tags)</sup>&nbsp;&nbsp;<sup>[valid tags](https://github.com/posit-dev/positron/blob/main/test/e2e/infra/test-runner/test-tags.ts)</sup>&nbsp;&nbsp;<sup>[why these tags?](https://github.com/posit-dev/positron/blob/main/test/e2e/README.md#automatic-tags-from-changed-files)</sup>%b" "$FORMATTED_TAGS" "$WARN_FMT")

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
