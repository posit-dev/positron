#!/bin/bash
# Usage:
# bash scripts/playwright-tags.sh <project> <tags>
# Example:
# bash scripts/playwright-tags.sh "browser" "@feat1,@feat2"

# Input parameters
PROJECT="$1"  # The PROJECT (e.g., e2e-electron, e2e-browser, e2e-windows)
TAGS="$2"      # Comma-separated tags (e.g., "@feat1,@feat2")

# Debug initial inputs
echo "Project: '$PROJECT'"
echo "Tags: '$TAGS'"

# Initialize regex or output
OUTPUT=""

# Determine prefix based on PROJECT
case "$PROJECT" in
  "e2e-browser")
    OUTPUT="(?=.*@web)"
    ;;
  "e2e-windows")
    OUTPUT="(?=.*@win)"
    ;;
  "e2e-electron")
    OUTPUT="" # No prefix for linux
    # Append @electron tag to linux
    if [[ -n "$TAGS" ]]; then
      TAGS="@electron,$TAGS"
    else
      TAGS="@electron"
    fi
    ;;
esac

# Append tags to the output
if [[ -n "$TAGS" ]]; then
  # Convert comma-separated tags into regex format for browser/windows
  if [[ "$PROJECT" == "e2e-browser" || "$PROJECT" == "e2e-windows" ]]; then
    TAGS_REGEX=$(echo "$TAGS" | tr ',' '\n' | sed 's/^/(?=.*&/' | sed 's/$/)/' | tr -d '\n')
    OUTPUT="$OUTPUT$TAGS_REGEX"
  else
    # Just append tags as-is for linux
    OUTPUT="$TAGS"
  fi
fi

# Output the final string
echo "$OUTPUT"

# Save to GITHUB_ENV
echo "PW_TAGS=$OUTPUT" >> $GITHUB_ENV
