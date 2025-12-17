#!/bin/bash
set -e

# Validate npm cache coverage by detecting uncached postinstall artifacts
#
# WHY THIS EXISTS:
# npm install runs postinstall scripts that download/build artifacts (Ark, Kallichore, Python
# libs, etc.). We cache these artifacts to speed up CI. If a postinstall creates artifacts that
# aren't in our cache paths, they'll be missing when the cache hits on the next run, causing
# mysterious test failures.
#
# HOW IT WORKS:
# 1. Before npm install: Capture file tree snapshot (excludes node_modules/)
# 2. After npm install: Capture file tree snapshot
# 3. This script: Diff the snapshots to find files added by postinstall
# 4. Verify: Check if added files are in our cached paths or can be safely ignored
#
# CACHE ARCHITECTURE:
# - npm-core: Core dependencies (root, build/, remote/, test/{integration,monaco,mcp})
# - npm-extensions: Extension dependencies (extensions/**/node_modules)
# - Separate binary caches: Ark (positron-r), Kallichore (positron-supervisor)
# - Also cached: Python vendored libs (positron-python), assistant resources, etc.
#
# WHAT TO DO IF THIS FAILS:
# If uncached artifacts are detected, update the cache paths in:
# - .github/actions/restore-build-caches/action.yml (Linux)
# - .github/actions/restore-build-caches-windows/action.yml (Windows)
# - .github/actions/save-build-caches/action.yml (Linux)
# - .github/actions/save-build-caches-windows/action.yml (Windows)
#
# Or if the artifacts are non-critical (tests pass without them), add to IGNORE_PATTERNS below.
#
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
