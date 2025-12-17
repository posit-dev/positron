#!/usr/bin/env bash
# Generate a deterministic hash for npm-extensions cache invalidation
#
# PURPOSE:
# Creates a composite hash that invalidates the npm-extensions cache when:
# 1. Extension dependencies change (package.json files)
# 2. Extension source code changes (git tree hash)
# 3. Git submodule commits change (e.g., positron-python vendored dependencies)
#
# WHY THREE COMPONENTS:
# - package.json hash: Detects when dependencies are added/removed/updated
# - git tree hash: Detects when extension source code changes (forces recompilation)
# - submodule SHAs: Detects when vendored dependencies (submodules) are updated
#
# WHY NOT package-lock.json:
# Lock files are modified during npm install (postinstall updates), making them unsuitable
# for cache keys. We use package.json which is stable across npm install runs.
#
# WHY EXCLUDE SUBMODULE FILES:
# Submodule files can cause non-deterministic hashes (depends on whether submodules are
# initialized). Instead, we hash the commit SHAs that submodules are pinned to.
#
# OUTPUT:
# Writes "hash=<sha256>" to $GITHUB_OUTPUT for use as npm-extensions cache key

set -euo pipefail

# Get list of all submodule paths in extensions/ and .vscode/
SUBMODULE_PATHS=$(git config --file .gitmodules --get-regexp path | grep -E '(extensions/|\.vscode/)' | awk '{print $2}' || echo "")

# Build find exclusion arguments for all submodules
FIND_EXCLUDES=""
if [ -n "$SUBMODULE_PATHS" ]; then
	while IFS= read -r submodule_path; do
		if [ -n "$submodule_path" ]; then
			FIND_EXCLUDES="$FIND_EXCLUDES ! -path \"*/${submodule_path#*/}/*\""
		fi
	done <<< "$SUBMODULE_PATHS"
fi

# Hash regular extension package.json files (excluding submodules)
FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f $FIND_EXCLUDES 2>/dev/null" | sort | xargs cat | sha256sum | cut -d' ' -f1)

# Get git tree hash for extensions directory (changes when any file in extensions/ changes)
# This ensures cache invalidates when source code changes, not just package.json
GIT_TREE_HASH=$(git rev-parse HEAD:extensions 2>/dev/null || echo "no-git-tree")

# Get all submodule commit SHAs (sorted for determinism)
SUBMODULE_SHAS=""
if [ -n "$SUBMODULE_PATHS" ]; then
	while IFS= read -r submodule_path; do
		if [ -n "$submodule_path" ]; then
			# Get the commit SHA that the submodule is pinned to in the main repo
			SHA=$(git ls-tree HEAD "$submodule_path" 2>/dev/null | awk '{print $3}')
			if [ -z "$SHA" ]; then
				echo "::warning::Could not read submodule commit SHA for $submodule_path - may not be initialized"
				SHA="uninitialized"
			fi
			SUBMODULE_SHAS="${SUBMODULE_SHAS}${submodule_path}:${SHA},"
		fi
	done <<< "$SUBMODULE_PATHS"
fi

# Combine all into final hash (package.json + git tree + submodules)
EXTENSIONS_HASH=$(echo "${FILES_HASH}-${GIT_TREE_HASH}-${SUBMODULE_SHAS}" | sha256sum | cut -d' ' -f1)

# Validate hash is not empty
if [ -z "$EXTENSIONS_HASH" ]; then
	echo "::warning::extensions hash generation failed. Cache will be disabled for this run."
	exit 1
fi

# Output to GITHUB_OUTPUT (if running in CI) or stdout (if running locally)
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	echo "hash=$EXTENSIONS_HASH" >> "$GITHUB_OUTPUT"
fi
echo "Generated extensions hash: $EXTENSIONS_HASH (files: $FILES_HASH, git-tree: $GIT_TREE_HASH, submodules: ${SUBMODULE_SHAS:-none})"
