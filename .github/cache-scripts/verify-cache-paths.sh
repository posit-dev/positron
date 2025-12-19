#!/usr/bin/env bash
# ============================================================================
# verify-cache-paths.sh - Cache Configuration Validation
# ============================================================================
#
# WHAT THIS DOES:
# Validates that cache-paths.sh (the single source of truth) loads correctly
# and that action.yml files properly reference it. This catches configuration
# errors before they cause CI failures.
#
# WHY WE NEED THIS:
# The caching system relies on cache-paths.sh exporting paths dynamically.
# If that file has syntax errors or action files are misconfigured, caches
# won't work. This script catches those issues early.
#
# THREE VALIDATION TESTS:
# 1. Path definitions     → Ensures all cache path variables are non-empty
# 2. GITHUB_OUTPUT export → Tests that paths can be exported to GitHub Actions
# 3. Dynamic loading      → Verifies action.yml files use dynamic path references
#
# WHAT TO DO IF TESTS FAIL:
# • Check .github/cache-scripts/cache-paths.sh for syntax errors
# • Run cache-paths.sh directly to see specific error messages
# • Verify action.yml files use: ${{ steps.cache-paths.outputs.* }}
#
# USAGE:
# ./verify-cache-paths.sh
#
# EXIT CODES:
# 0 → All validation passed, caching system is properly configured
# 1 → Validation failed, ACTION REQUIRED before merging
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Load Configuration
# ============================================================================
# Source cache-paths.sh to load all path definitions and functions.
# If this fails (syntax error), script will exit immediately due to set -e.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/cache-paths.sh"

RESTORE_ACTION="$SCRIPT_DIR/../actions/restore-build-caches/action.yml"
SAVE_ACTION="$SCRIPT_DIR/../actions/save-build-caches/action.yml"

echo "🔍 Verifying cache path configuration..."
echo ""

EXIT_CODE=0

# ============================================================================
# SECTION 2: Test 1 - Verify Path Definitions
# ============================================================================
# Check that all required cache path variables are defined and non-empty.
# Empty paths would cause caches to not save/restore anything.

echo "Test 1: Checking that cache paths are defined..."

if [ -z "$NPM_CORE_PATHS" ]; then
	echo "  ❌ NPM_CORE_PATHS is empty"
	EXIT_CODE=1
else
	PATH_COUNT=$(echo "$NPM_CORE_PATHS" | wc -l | tr -d ' ')
	echo "  ✅ NPM_CORE_PATHS defined ($PATH_COUNT paths)"
fi

if [ -z "$NPM_EXTENSIONS_VOLATILE_PATHS" ]; then
	echo "  ❌ NPM_EXTENSIONS_VOLATILE_PATHS is empty"
	EXIT_CODE=1
else
	PATH_COUNT=$(echo "$NPM_EXTENSIONS_VOLATILE_PATHS" | wc -l | tr -d ' ')
	echo "  ✅ NPM_EXTENSIONS_VOLATILE_PATHS defined ($PATH_COUNT paths)"
fi

if [ -z "$NPM_EXTENSIONS_STABLE_PATHS" ]; then
	echo "  ❌ NPM_EXTENSIONS_STABLE_PATHS is empty"
	EXIT_CODE=1
else
	PATH_COUNT=$(echo "$NPM_EXTENSIONS_STABLE_PATHS" | wc -l | tr -d ' ')
	echo "  ✅ NPM_EXTENSIONS_STABLE_PATHS defined ($PATH_COUNT paths)"
fi

if [ -z "$BUILTINS_PATHS" ]; then
	echo "  ❌ BUILTINS_PATHS is empty"
	EXIT_CODE=1
else
	PATH_COUNT=$(echo "$BUILTINS_PATHS" | wc -l | tr -d ' ')
	echo "  ✅ BUILTINS_PATHS defined ($PATH_COUNT paths)"
fi

if [ -z "$PLAYWRIGHT_PATHS" ]; then
	echo "  ❌ PLAYWRIGHT_PATHS is empty"
	EXIT_CODE=1
else
	PATH_COUNT=$(echo "$PLAYWRIGHT_PATHS" | wc -l | tr -d ' ')
	echo "  ✅ PLAYWRIGHT_PATHS defined ($PATH_COUNT paths)"
fi

# ============================================================================
# SECTION 3: Test 2 - Verify GITHUB_OUTPUT Export
# ============================================================================
# Test that output_to_github_actions() function works correctly.
# This function is called in action.yml to export paths for cache steps.

echo ""
echo "Test 2: Testing GITHUB_OUTPUT export function..."

TEMP_OUTPUT=$(mktemp)
GITHUB_OUTPUT="$TEMP_OUTPUT" output_to_github_actions

# Verify the temp file has content and expected heredoc delimiters
if [ -s "$TEMP_OUTPUT" ]; then
	if grep -q "npm-core-paths<<EOF" "$TEMP_OUTPUT" && \
	   grep -q "npm-extensions-volatile-paths<<EOF" "$TEMP_OUTPUT" && \
	   grep -q "npm-extensions-stable-paths<<EOF" "$TEMP_OUTPUT" && \
	   grep -q "builtins-paths<<EOF" "$TEMP_OUTPUT" && \
	   grep -q "playwright-paths<<EOF" "$TEMP_OUTPUT"; then
		echo "  ✅ GITHUB_OUTPUT export works correctly"
	else
		echo "  ❌ GITHUB_OUTPUT missing expected delimiters"
		echo "     Check output_to_github_actions() in cache-paths.sh"
		EXIT_CODE=1
	fi
else
	echo "  ❌ GITHUB_OUTPUT export failed (file empty)"
	echo "     Check output_to_github_actions() for errors"
	EXIT_CODE=1
fi

rm -f "$TEMP_OUTPUT"

# ============================================================================
# SECTION 4: Test 3 - Verify Dynamic Loading in Actions
# ============================================================================
# Ensure restore-build-caches and save-build-caches action files reference
# dynamically loaded paths instead of hardcoded values.
#
# Expected pattern: ${{ steps.cache-paths.outputs.npm-core-paths }}
# BAD pattern: Hardcoded path list in action.yml

echo ""
echo "Test 3: Verifying action files use dynamic path loading..."

if grep -q 'steps.cache-paths.outputs.npm-core-paths' "$RESTORE_ACTION" && \
   grep -q 'steps.cache-paths.outputs.npm-core-paths' "$SAVE_ACTION"; then
	echo "  ✅ Action files use dynamic path references"
else
	echo "  ❌ Action files don't use dynamic paths"
	echo "     Expected: path: \${{ steps.cache-paths.outputs.npm-core-paths }}"
	echo "     Check: .github/actions/restore-build-caches/action.yml"
	echo "     Check: .github/actions/save-build-caches/action.yml"
	EXIT_CODE=1
fi

# ============================================================================
# SECTION 5: Report Results
# ============================================================================

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
	echo "  1. Check .github/cache-scripts/cache-paths.sh for syntax errors"
	echo "  2. Run directly for debugging: .github/cache-scripts/cache-paths.sh"
	echo "  3. Fix any issues found above"
	echo "  4. Re-run this script to verify fixes"
fi

exit $EXIT_CODE
