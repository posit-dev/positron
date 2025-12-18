#!/usr/bin/env bash
set -euo pipefail

# verify-cache-paths.sh
#
# Verifies that cache-paths.sh loads correctly and exports paths properly.
# Since the action.yml files now load paths dynamically at runtime, this script
# primarily validates that the source of truth file works as expected.
#
# Usage: ./verify-cache-paths.sh
# Exit codes:
#   0: Cache paths load successfully
#   1: Cache paths failed to load (ACTION REQUIRED)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/cache-paths.sh"

RESTORE_ACTION="$SCRIPT_DIR/../actions/restore-build-caches/action.yml"
SAVE_ACTION="$SCRIPT_DIR/../actions/save-build-caches/action.yml"

echo "🔍 Verifying cache path configuration..."
echo ""

EXIT_CODE=0

# Test 1: Verify paths are defined and non-empty
echo "Test 1: Checking that cache paths are defined..."
if [ -z "$NPM_CORE_PATHS" ]; then
	echo "  ❌ NPM_CORE_PATHS is empty"
	EXIT_CODE=1
else
	echo "  ✅ NPM_CORE_PATHS defined ($(echo "$NPM_CORE_PATHS" | wc -l | tr -d ' ') paths)"
fi

if [ -z "$NPM_EXTENSIONS_PATHS" ]; then
	echo "  ❌ NPM_EXTENSIONS_PATHS is empty"
	EXIT_CODE=1
else
	echo "  ✅ NPM_EXTENSIONS_PATHS defined ($(echo "$NPM_EXTENSIONS_PATHS" | wc -l | tr -d ' ') paths)"
fi

if [ -z "$BUILTINS_PATHS" ]; then
	echo "  ❌ BUILTINS_PATHS is empty"
	EXIT_CODE=1
else
	echo "  ✅ BUILTINS_PATHS defined ($(echo "$BUILTINS_PATHS" | wc -l | tr -d ' ') paths)"
fi

# Test 2: Verify GITHUB_OUTPUT function works
echo ""
echo "Test 2: Testing GITHUB_OUTPUT export function..."
TEMP_OUTPUT=$(mktemp)
GITHUB_OUTPUT="$TEMP_OUTPUT" output_to_github_actions

if [ -s "$TEMP_OUTPUT" ]; then
	if grep -q "npm-core-paths<<EOF" "$TEMP_OUTPUT" && \
	   grep -q "npm-extensions-paths<<EOF" "$TEMP_OUTPUT" && \
	   grep -q "builtins-paths<<EOF" "$TEMP_OUTPUT"; then
		echo "  ✅ GITHUB_OUTPUT export works correctly"
	else
		echo "  ❌ GITHUB_OUTPUT missing expected delimiters"
		EXIT_CODE=1
	fi
else
	echo "  ❌ GITHUB_OUTPUT export failed (file empty)"
	EXIT_CODE=1
fi
rm -f "$TEMP_OUTPUT"

# Test 3: Verify action files use dynamic loading
echo ""
echo "Test 3: Verifying action files use dynamic path loading..."
if grep -q 'steps.cache-paths.outputs.npm-core-paths' "$RESTORE_ACTION" && \
   grep -q 'steps.cache-paths.outputs.npm-core-paths' "$SAVE_ACTION"; then
	echo "  ✅ Action files use dynamic path references"
else
	echo "  ❌ Action files don't use dynamic paths"
	echo "     Expected: path: \${{ steps.cache-paths.outputs.npm-core-paths }}"
	EXIT_CODE=1
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
	echo "🎉 All cache path validation passed!"
	echo ""
	echo "Cache paths are loaded dynamically from cache-paths.sh"
	echo "No manual syncing of action.yml files needed!"
else
	echo "❌ Cache path validation FAILED!"
	echo ""
	echo "ACTION REQUIRED:"
	echo "  Check .github/scripts/cache-paths.sh for syntax errors"
	echo "  Run: .github/scripts/cache-paths.sh (for debugging)"
fi

exit $EXIT_CODE
