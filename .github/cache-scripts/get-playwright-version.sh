#!/usr/bin/env bash
# ============================================================================
# get-playwright-version.sh - Playwright Version Extractor
# ============================================================================
#
# WHAT THIS DOES:
# Extracts the @playwright/test version from package.json and exports it
# for use in cache key generation. This ensures Playwright browser caches
# invalidate when the Playwright version changes.
#
# WHY WE NEED THIS:
# Playwright browser binaries are version-specific. If we upgrade Playwright
# from 1.40.0 to 1.41.0, we need new browser binaries. Using the version in
# the cache key ensures we get fresh binaries when Playwright updates.
#
# HOW IT WORKS:
# 1. Read package.json using Node.js (handles JSON parsing reliably)
# 2. Extract version from devDependencies or dependencies
# 3. Strip version prefix (^1.40.0 → 1.40.0)
# 4. Export to GITHUB_OUTPUT for use in cache key
#
# CACHE KEY EXAMPLE:
# playwright-v1-Linux-1.40.0
#                       ^^^^^^ This version comes from this script
#
# USAGE:
# ./get-playwright-version.sh
#
# OUTPUT:
# Sets GITHUB_OUTPUT variable 'version' with clean Playwright version
# (Prints to stdout for debugging: "Playwright version: 1.40.0")
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Extract Version from package.json
# ============================================================================
# Use Node.js to read package.json and extract @playwright/test version.
# Node.js is more reliable than bash JSON parsing (handles escaping, etc.)

echo "Reading @playwright/test version from package.json..."

PW_VERSION=$(node -e "
const pkg = require('./package.json');

// Check both devDependencies and dependencies
const version = pkg.devDependencies['@playwright/test'] || pkg.dependencies['@playwright/test'];

if (!version) {
	console.error('❌ Error: @playwright/test not found in package.json');
	process.exit(1);
}

// Remove version prefix (^, ~, etc.)
// Examples:
//   ^1.40.0 → 1.40.0
//   ~1.40.0 → 1.40.0
//   1.40.0  → 1.40.0 (unchanged)
const cleanVersion = version.replace(/^[\^~]/, '');

console.log(cleanVersion);
")

# Validate version was extracted
if [ -z "$PW_VERSION" ]; then
	echo "❌ Failed to extract Playwright version"
	exit 1
fi

# ============================================================================
# SECTION 2: Output Version
# ============================================================================
# Export to GITHUB_OUTPUT (if in CI) and print to stdout (for debugging).

echo "✓ Playwright version: $PW_VERSION"

# Output to GitHub Actions if running in CI
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	echo "version=$PW_VERSION" >> "$GITHUB_OUTPUT"
fi
