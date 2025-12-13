#!/usr/bin/env bash
# Calculate hash of all package-lock.json files that get modified during postinstall
# This is the single source of truth for which package-lock files to include in npm cache keys
# See build/npm/dirs.js for the list of directories that get npm install during postinstall

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
