#!/usr/bin/env bash
# Validate and pass through package-locks hash for npm-core cache key
#
# PURPOSE:
# The npm-core cache invalidates when any "core" package-lock.json file changes.
# Core = non-extension directories: root, build/, remote/, test/{integration,monaco,mcp}
#
# WHY THIS SCRIPT:
# The hash is calculated using GitHub's hashFiles() in the workflow (faster, no shell needed).
# This script validates the hash and outputs it in the expected format for cache actions.
#
# IMPORTANT:
# The hashFiles() call in restore-build-caches*/action.yml MUST match the directories
# listed in build/npm/dirs.js (lines 9-12, 74-81) to ensure cache invalidates correctly.
#
# Currently includes:
# - package-lock.json (root)
# - build/package-lock.json
# - remote/package-lock.json
# - remote/web/package-lock.json
# - remote/reh-web/package-lock.json
# - test/e2e/package-lock.json (for E2E builds)
# - test/integration/browser/package-lock.json
# - test/monaco/package-lock.json
# - test/mcp/package-lock.json
#
# OUTPUT:
# Writes "hash=<sha256>" to $GITHUB_OUTPUT for use as npm-core cache key

set -euo pipefail

# This must match the hashFiles() call in the workflow
PACKAGE_LOCKS_HASH=$(echo "$1")

# Validate hash is not empty
if [ -z "$PACKAGE_LOCKS_HASH" ]; then
	echo "::warning::package-locks hash is empty. Check that hashFiles() in workflow includes all required package-lock.json files. Cache will be disabled for this run."
	exit 1
fi

echo "hash=$PACKAGE_LOCKS_HASH" >> "$GITHUB_OUTPUT"
echo "Generated package-locks hash: $PACKAGE_LOCKS_HASH"
