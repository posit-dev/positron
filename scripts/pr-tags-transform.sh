#!/bin/bash
# Usage:
# bash scripts/pr-tags-transform.sh <project> <tags>
# Example:
# bash scripts/pr-tags-transform.sh "e2e-browser" "@:feat1,@:feat2"

# Input parameters
PROJECT="$1"  # The PROJECT (e.g., e2e-electron, e2e-browser, e2e-windows)
TAGS="$2"     # Comma-separated tags (e.g., "@:feat1,@:feat2")

# Debug initial inputs
echo "Input:"
echo "  * Project: '$PROJECT'"
echo "  * Tags: '$TAGS'"

# Initialize regex or output
OUTPUT=""

# Filter and preprocess tags based on project
if [[ "$PROJECT" == "e2e-windows" ]]; then
  # Remove @:win from the tags
  TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@:win" | sort -u | tr '\n' ',' | sed 's/,$//')
	# If @:web is present, remove it
	if echo "$TAGS" | grep -q "@:web"; then
    TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@:web" | sort -u | tr '\n' ',' | sed 's/,$//')
  fi
elif [[ "$PROJECT" == "e2e-browser" ]]; then
  # Remove @:web from the tags
  TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@:web" | sort -u | tr '\n' ',' | sed 's/,$//')
	# If @:win is present, remove it
	if echo "$TAGS" | grep -q "@:win"; then
    TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@:win" | sort -u | tr '\n' ',' | sed 's/,$//')
  fi
else
  # Deduplicate for other projects
  TAGS=$(echo "$TAGS" | tr ',' '\n' | sort -u | tr '\n' ',' | sed 's/,$//')
	# If @:web is present, remove it
	if echo "$TAGS" | grep -q "@:web"; then
    TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@:web" | sort -u | tr '\n' ',' | sed 's/,$//')
  fi
	# If @:win is present, remove it
	if echo "$TAGS" | grep -q "@:win"; then
    TAGS=$(echo "$TAGS" | tr ',' '\n' | grep -v "@:win" | sort -u | tr '\n' ',' | sed 's/,$//')
  fi
fi

# Determine prefix based on PROJECT
case "$PROJECT" in
  "e2e-browser")
    OUTPUT="(?=.*@:web)"  # Base tag for browser
    ;;
  "e2e-windows")
    OUTPUT="(?=.*@:win)"  # Base tag for windows
    ;;
  "e2e-electron")
    OUTPUT="" # No prefix for linux
    ;;
	"inspect-ai")
		OUTPUT="(?=.*@:inspect-ai)"  # Base tag for inspect-ai
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
else
  # Ensure OUTPUT remains explicitly an empty string if TAGS is empty
  OUTPUT="${OUTPUT:-}"
fi

# Output the final string
echo "Output:"
echo "  * '${OUTPUT}'"  # Show quotes for clarity

# Save to GITHUB_ENV
echo "PW_TAGS=${OUTPUT}" >> $GITHUB_ENV

