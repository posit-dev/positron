#!/bin/bash
# Usage:
# bash scripts/pr-tags-transform.sh <project> <tags>
# Example:
# bash scripts/pr-tags-transform.sh "e2e-chromium" "@:feat1,@:feat2"
#
# Writes PW_TAGS (the lane's Playwright --grep regex) to $GITHUB_ENV. The regex
# itself comes from pw_tags_regex so the shard-count listing in
# pr-tags-parse.sh selects exactly what the lane runs.

source "$(dirname "$0")/lib/pr-tags-lib.sh"

PROJECT="$1"  # The PROJECT (e.g., e2e-electron, e2e-chromium, e2e-windows)
TAGS="$2"     # Comma-separated tags (e.g., "@:feat1,@:feat2")

echo "Input:"
echo "  * Project: '$PROJECT'"
echo "  * Tags: '$TAGS'"

OUTPUT="$(pw_tags_regex "$PROJECT" "$TAGS")" || exit 1

echo "Output:"
echo "  * '${OUTPUT}'"  # Show quotes for clarity

echo "PW_TAGS=${OUTPUT}" >> $GITHUB_ENV
