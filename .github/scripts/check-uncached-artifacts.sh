#!/bin/bash
set -e

# Detect uncached postinstall artifacts
#
# WHY THIS EXISTS:
# npm install runs postinstall scripts that download/build artifacts (Python libs, vendored
# packages, etc.). We cache npm_modules + some postinstall artifacts to speed up CI. If a
# postinstall creates artifacts that aren't in our cache paths, they'll be missing when the
# cache hits on the next run, causing mysterious test failures.
#
# HOW IT WORKS:
# 1. Before npm install: Capture file tree snapshot (excludes node_modules/)
# 2. After npm install: Capture file tree snapshot
# 3. This script: Diff the snapshots to find files added outside node_modules
# 4. Report them so you can decide if they need caching
#
# WHAT TO DO IF FILES ARE DETECTED:
# Option A: Add to cache (if tests need these files)
#   - .github/actions/restore-build-caches/action.yml (add path to appropriate cache)
#   - .github/actions/save-build-caches/action.yml (add path to appropriate cache)
#
# Option B: Ignore (if tests don't need these files)
#   - Add pattern to IGNORE_PATTERNS array below (line 45)
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

# Find files added by npm install (excluding node_modules and npm cache)
ADDED_FILES=$(comm -13 "$BEFORE_FILE" "$AFTER_FILE" | grep -v "\.npm-cache" | grep -v "node_modules" || true)

# Known non-critical files that don't need caching (tests pass without them)
# Add patterns here if you want to suppress warnings for specific files
IGNORE_PATTERNS=(
  "extensions/positron-python/resources/pet/VERSION"
)

# Filter out ignored patterns
UNCACHED_FILES=""
while IFS= read -r file; do
  [ -z "$file" ] && continue

  IS_IGNORED=false
  for pattern in "${IGNORE_PATTERNS[@]}"; do
    if [[ "$file" == *"$pattern"* ]]; then
      IS_IGNORED=true
      break
    fi
  done

  if [[ "$IS_IGNORED" == false ]]; then
    UNCACHED_FILES="$UNCACHED_FILES$file\n"
  fi
done <<< "$ADDED_FILES"

# Report results
TOTAL_ADDED=$(echo "$ADDED_FILES" | grep -v '^$' | wc -l | tr -d ' ')
UNCACHED_COUNT=$(echo -e "$UNCACHED_FILES" | grep -v '^$' | wc -l | tr -d ' ')

echo "Files added outside node_modules: $TOTAL_ADDED"
echo "Files ignored by IGNORE_PATTERNS: $((TOTAL_ADDED - UNCACHED_COUNT))"

if [[ $UNCACHED_COUNT -gt 0 ]]; then
  echo ""
  echo "🚨 WARNING: npm install created $UNCACHED_COUNT files outside node_modules/"
  echo ""
  echo "These files are NOT cached and will be missing when caches hit."
  echo ""
  echo "Files (first 50):"
  echo -e "$UNCACHED_FILES" | grep -v '^$' | head -50
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "ACTION REQUIRED: Choose one of the following:"
  echo ""
  echo "✅ Option A: Add to cache (if tests need these files)"
  echo "   Edit these 2 files and add the path(s) to the appropriate cache:"
  echo "   1. .github/actions/restore-build-caches/action.yml"
  echo "   2. .github/actions/save-build-caches/action.yml"
  echo ""
  echo "   Look for cache sections like 'npm core', 'npm extensions', 'builtins', etc."
  echo ""
  echo "❌ Option B: Ignore (if tests don't need these files)"
  echo "   Edit this file and add pattern to IGNORE_PATTERNS (line 45):"
  echo "   - .github/scripts/check-uncached-artifacts.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "⚠️ Uncached Postinstall Artifacts Detected" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY
    echo "npm install created $UNCACHED_COUNT files outside node_modules/" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY
    echo "See workflow logs for details and action required." >> $GITHUB_STEP_SUMMARY
  fi

  # Don't fail - just warn. Let humans decide if it's critical.
  exit 0
else
  echo "✅ No uncached artifacts detected"
fi
