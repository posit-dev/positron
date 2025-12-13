#!/usr/bin/env bash
# Generate a hash of all extension + .vscode package.json files
# Use package.json instead of package-lock.json because lock files get modified during npm install
# Exclude git submodules from file hash as they can cause non-deterministic hashes
# For submodules, include the commit SHAs directly in the hash for deterministic cache invalidation
# Note: Tried using hashFiles() with glob patterns, but it didn't work as expected so building own hash

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

# Combine both into final hash
EXTENSIONS_HASH=$(echo "${FILES_HASH}-${SUBMODULE_SHAS}" | sha256sum | cut -d' ' -f1)

# Validate hash is not empty
if [ -z "$EXTENSIONS_HASH" ]; then
	echo "::warning::extensions hash generation failed. Cache will be disabled for this run."
	exit 1
fi

echo "hash=$EXTENSIONS_HASH" >> "$GITHUB_OUTPUT"
echo "Generated extensions hash: $EXTENSIONS_HASH (files: $FILES_HASH, submodules: ${SUBMODULE_SHAS:-none})"
