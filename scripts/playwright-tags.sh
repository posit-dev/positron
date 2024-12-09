#!/bin/bash
# Usage:
# bash scripts/playwright-tags.sh <project> <tags>
# Example:
# bash scripts/playwright-tags.sh "e2e-browser" "@feat1,@feat2"

# Input parameters
PROJECT="$1"  # The PROJECT (e.g., e2e-electron, e2e-browser, e2e-windows)
TAGS="$2"     # Comma-separated tags (e.g., "@feat1,@feat2")

# Debug initial inputs
echo "Input:"
echo "  * Project: '$PROJECT'"
echo "  * Tags: '$TAGS'"

# Initialize regex or output
OUTPUT=""

# Filter and preprocess tags based on project
if [[ "$PROJECT" == "e2e-windows" ]]; then
  # Remove @win from the tags
  TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@win" | tr '\n' ',' | sed 's/,$//')
elif [[ "$PROJECT" == "e2e-browser" ]]; then
  # Remove @web from the tags
  TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@web" | tr '\n' ',' | sed 's/,$//')
fi

# Determine prefix based on PROJECT
case "$PROJECT" in
  "e2e-browser")
    OUTPUT="(?=.*@web)"  # Base tag for browser
    ;;
  "e2e-windows")
    OUTPUT="(?=.*@win)"  # Base tag for windows
    ;;
  "e2e-electron")
    OUTPUT="" # No prefix for linux
    ;;
  *)
    echo "Unknown PROJECT: $PROJECT"
    exit 1
    ;;
esac

# Append OR logic for additional tags
if [[ -n "$TAGS" ]]; then
  # Convert comma-separated tags into OR regex format
  TAGS_REGEX=$(echo "$TAGS" | tr ',' '|' | sed 's/^/(?=.*(/;s/$/))/' | sed 's/|)/)/') # Create OR condition
  OUTPUT="$OUTPUT$TAGS_REGEX"
fi

# Output the final string
echo "Output:"
echo "  * $OUTPUT"

# Save to GITHUB_ENV
echo "PW_TAGS=$OUTPUT" >> $GITHUB_ENV
