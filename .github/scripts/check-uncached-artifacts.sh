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
#   - Edit .github/scripts/cache-paths.sh (add path to appropriate cache section)
#   - Run .github/scripts/verify-cache-paths.sh to verify
#
# Option B: Ignore (if tests don't need these files)
#   - Add pattern to IGNORE_PATTERNS array below
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

# Load cache path configuration (single source of truth)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/cache-paths.sh"

# Build ignore patterns from cache configuration
# These files are already covered by our cache config, so no warning needed
IGNORE_PATTERNS=()
while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  IGNORE_PATTERNS+=("$pattern")
done < <(get_npm_extensions_patterns)

# Additional one-off files that don't need caching (tests pass without them)
# Ark and Kallichore binaries are intentionally NOT cached because:
#   - They're platform-specific (can't share between Linux/Windows/Mac)
#   - They're large (~50-100MB combined)
#   - They're quick to download from GitHub
#   - Workflows explicitly run 'npm rebuild --foreground-scripts' when cache hits
IGNORE_PATTERNS+=(
  "extensions/positron-python/resources/pet/VERSION"
  "extensions/positron-r/resources/ark"
  "extensions/positron-supervisor/resources/kallichore"
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
  echo ""
  echo "   For core/build/test paths:"
  echo "     → Edit .github/scripts/cache-paths.sh (NPM_CORE_PATHS or BUILTINS_PATHS)"
  echo ""
  echo "   For extension paths:"
  echo "     → Volatile extensions (python/assistant/r): Edit build/npm/dirs.js"
  echo "       Add to volatileExtensions array - entire directory will be cached"
  echo "     → Stable extensions: Already cached automatically!"
  echo "       All extension directories not in volatileExtensions are cached"
  echo ""
  echo "   That's it! The action files load paths dynamically."
  echo "   Optionally verify: .github/scripts/verify-cache-paths.sh"
  echo ""
  echo "❌ Option B: Ignore (if tests don't need these files)"
  echo "   Add pattern to IGNORE_PATTERNS in this file (~line 60):"
  echo "   - .github/scripts/check-uncached-artifacts.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "⚠️ Uncached Postinstall Artifacts Detected" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY
    echo "npm install created $UNCACHED_COUNT files outside node_modules/" >> $GITHUB_STEP_SUMMARY
    echo "" >> $GITHUB_STEP_SUMMARY
    echo "Check the \"uncached postinstall artifacts\" step for more details." >> $GITHUB_STEP_SUMMARY
  fi

  # Don't fail - just warn. Let humans decide if it's critical.
  exit 0
else
  echo "✅ No uncached artifacts detected"
fi
