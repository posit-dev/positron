#!/bin/bash
set -e

# Check for postinstall artifacts that aren't in our caches
# Usage: check-uncached-artifacts.sh <before-file> <after-file>

BEFORE_FILE="$1"
AFTER_FILE="$2"

if [[ ! -f "$BEFORE_FILE" ]] || [[ ! -f "$AFTER_FILE" ]]; then
  echo "Error: File tree snapshots not found"
  echo "Usage: $0 <before-file> <after-file>"
  exit 1
fi

echo "🔍 Checking for uncached postinstall artifacts..."

# Find files added by npm install
ADDED_FILES=$(comm -13 "$BEFORE_FILE" "$AFTER_FILE" | grep -v "\.npm-cache" | grep -v "node_modules")

# Filter for files in known cached locations or known non-critical files
CACHED_PATTERNS=(
  "extensions/positron-r/resources/ark"
  "extensions/positron-supervisor/resources/kallichore"
  "extensions/positron-assistant/resources"
  "extensions/positron-python/python-env-tools"
  "extensions/positron-python/python_files"
)

# Known non-critical files that don't need caching (tests pass without them)
IGNORE_PATTERNS=(
  "extensions/positron-python/resources/pet/VERSION"
)

# Find files NOT in any cached location and NOT in ignore list
UNCACHED_FILES=""
while IFS= read -r file; do
  IS_CACHED=false
  IS_IGNORED=false

  # Check if cached
  for pattern in "${CACHED_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      IS_CACHED=true
      break
    fi
  done

  # Check if ignored
  for pattern in "${IGNORE_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      IS_IGNORED=true
      break
    fi
  done

  if [[ "$IS_CACHED" == false && "$IS_IGNORED" == false ]]; then
    UNCACHED_FILES="$UNCACHED_FILES$file\n"
  fi
done <<< "$ADDED_FILES"

# Report results
TOTAL_ADDED=$(echo "$ADDED_FILES" | wc -l)
UNCACHED_COUNT=$(echo -e "$UNCACHED_FILES" | grep -v '^$' | wc -l)

echo "Total files added by npm install: $TOTAL_ADDED"
echo "Files in cached locations: $((TOTAL_ADDED - UNCACHED_COUNT))"
echo "⚠️  Files in UNCACHED locations: $UNCACHED_COUNT"

if [[ $UNCACHED_COUNT -gt 0 ]]; then
  echo ""
  echo "🚨 WARNING: npm install created files outside cached paths!"
  echo "These files will be missing when caches hit, causing test failures."
  echo ""
  echo "Uncached files (first 50):"
  echo -e "$UNCACHED_FILES" | grep -v '^$' | head -50
  echo ""
  echo "⚠️ Uncached Postinstall Artifacts Detected" >> $GITHUB_STEP_SUMMARY
  echo "npm install created $UNCACHED_COUNT files outside cached paths." >> $GITHUB_STEP_SUMMARY
  echo "Update cache paths in .github/actions/*-build-caches*/action.yml" >> $GITHUB_STEP_SUMMARY
else
  echo "✅ All postinstall artifacts are in cached locations"
fi
