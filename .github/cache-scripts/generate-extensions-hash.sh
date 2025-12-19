#!/usr/bin/env bash
# Generate a deterministic hash for npm-extensions cache invalidation
#
# PURPOSE:
# Creates a composite hash that invalidates the npm-extensions cache when:
# 1. Extension dependencies change (package.json files)
# 2. Extension source code changes (git tree hash)
# 3. Git submodule commits change (e.g., positron-copilot-chat submodule SHA)
#
# SPLIT CACHE STRATEGY:
# Extensions are split into two caches based on change frequency:
#
# VOLATILE CACHE (npm-extensions-volatile-v1-{OS}-{distro}-{hash}):
#   - positron-python, positron-assistant, positron-r
#   - Changes frequently: 71% of extension commits (1,282 changes / 6 months)
#   - Size: ~973MB
#   - Invalidates often but fast to rebuild
#
# STABLE CACHE (npm-extensions-stable-v1-{OS}-{distro}-{hash}):
#   - All other extensions (~25+ extensions) + submodules
#   - Changes rarely: 29% of extension commits (~418 changes / 6 months)
#   - Size: ~2.7GB
#   - Invalidates rarely, saving significant CI time
#
# HASH COMPONENTS:
# Each hash is composed of three parts to detect different types of changes:
#
# 1. PACKAGE.JSON HASH:
#    - Hashes contents of package.json files
#    - Detects when dependencies are added/removed/updated
#    - Why not package-lock.json? Lock files are modified during npm install
#      (postinstall updates), making them unsuitable for cache keys
#
# 2. GIT TREE HASH:
#    - Hashes the git tree object for each extension directory
#    - Detects when ANY file in the extension changes (source code, configs, etc.)
#    - Forces recompilation when source changes, not just dependencies
#
# 3. SUBMODULE COMMIT SHAs:
#    - Hashes the commit SHA that each submodule is pinned to (see .gitmodules)
#    - Detects when vendored dependencies (submodules) are updated
#    - Why separate? Submodule files may or may not exist on disk (depends on initialization)
#      but the commit SHA is always available in parent repo's index (git ls-tree)
#    - This ensures deterministic hashing regardless of submodule checkout state
#
# ============================================================================
# FILTERING (VOLATILE vs STABLE)
# ============================================================================
# When --filter is specified, all three components are filtered:
#
# Volatile filter (--filter volatile):
#   - package.json hash: Only python, assistant, r
#   - git tree hash: Only python, assistant, r
#   - submodule SHAs: Only submodules INSIDE volatile extensions
#     (currently none; positron-copilot-chat is top-level)
#
# Stable filter (--filter stable):
#   - package.json hash: All except python, assistant, r
#   - git tree hash: All except python, assistant, r
#   - submodule SHAs: All submodules EXCEPT those inside volatile extensions
#     (includes positron-copilot-chat since it's not inside volatile extensions)
#
# Result: Each cache invalidates independently based on its own extensions
#
# ============================================================================
# SINGLE SOURCE OF TRUTH
# ============================================================================
# The volatile extension list is defined in build/npm/dirs.js and exported:
#   exports.volatileExtensions = ['extensions/positron-python', ...]
#
# This script reads from that file to ensure we never get out of sync:
#   VOLATILE_EXTENSIONS=$(node -e "require('./build/npm/dirs.js').volatileExtensions...")
#
# To add/remove volatile extensions: Edit build/npm/dirs.js only!
#
# ============================================================================
# USAGE
# ============================================================================
# ./generate-extensions-hash.sh [--filter volatile|stable]
#   --filter volatile: Generate hash for volatile extensions only
#   --filter stable: Generate hash for stable extensions only
#   (no filter): Generate hash for all extensions (legacy/deprecated)
#
# OUTPUT:
# Writes "hash=<sha256>" to $GITHUB_OUTPUT for use as cache key

set -euo pipefail

# Parse command line arguments
FILTER=""
while [[ $# -gt 0 ]]; do
	case $1 in
		--filter)
			FILTER="$2"
			shift 2
			;;
		*)
			echo "Unknown option: $1"
			echo "Usage: $0 [--filter volatile|stable]"
			exit 1
			;;
	esac
done

# Load volatile extensions list from SSOT (build/npm/dirs.js)
# This ensures we don't have to maintain the list in two places
VOLATILE_EXTENSIONS_RAW=$(node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")
# Convert to bash array
VOLATILE_EXTENSIONS=()
while IFS= read -r line; do
	VOLATILE_EXTENSIONS+=("$line")
done <<< "$VOLATILE_EXTENSIONS_RAW"

echo "Loaded ${#VOLATILE_EXTENSIONS[@]} volatile extensions from build/npm/dirs.js"

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

# Hash regular extension package.json files (excluding submodules, with filter if specified)
if [ "$FILTER" == "volatile" ]; then
	echo "Generating hash for volatile extensions only"
	# Build grep pattern for volatile extensions (use | for alternation in ERE)
	FILTER_PATTERN=$(IFS='|'; echo "${VOLATILE_EXTENSIONS[*]}")
	FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f $FIND_EXCLUDES 2>/dev/null" | grep -E "($FILTER_PATTERN)" | sort | xargs cat 2>/dev/null | sha256sum | cut -d' ' -f1)
elif [ "$FILTER" == "stable" ]; then
	echo "Generating hash for stable extensions only"
	# Build grep pattern to exclude volatile extensions
	FILTER_PATTERN=$(IFS='|'; echo "${VOLATILE_EXTENSIONS[*]}")
	FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f $FIND_EXCLUDES 2>/dev/null" | grep -v -E "($FILTER_PATTERN)" | sort | xargs cat 2>/dev/null | sha256sum | cut -d' ' -f1)
else
	# No filter
	FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f $FIND_EXCLUDES 2>/dev/null" | sort | xargs cat 2>/dev/null | sha256sum | cut -d' ' -f1)
fi

# Get git tree hash for extensions directory (changes when any file in extensions/ changes)
# This ensures cache invalidates when source code changes, not just package.json
if [ "$FILTER" == "volatile" ]; then
	# Hash only volatile extension directories
	GIT_TREE_HASH=""
	for ext in "${VOLATILE_EXTENSIONS[@]}"; do
		TREE_HASH=$(git rev-parse "HEAD:$ext" 2>/dev/null || echo "no-tree")
		GIT_TREE_HASH="${GIT_TREE_HASH}${TREE_HASH}"
	done
	GIT_TREE_HASH=$(echo "$GIT_TREE_HASH" | sha256sum | cut -d' ' -f1)
elif [ "$FILTER" == "stable" ]; then
	# Hash all extensions except volatile ones
	# Get all extension subdirs, exclude volatile ones, hash their trees
	ALL_EXT_DIRS=$(find extensions -maxdepth 1 -type d | tail -n +2 | sort)
	GIT_TREE_HASH=""
	for ext_dir in $ALL_EXT_DIRS; do
		# Check if this is a volatile extension
		is_volatile=false
		for volatile_ext in "${VOLATILE_EXTENSIONS[@]}"; do
			if [ "$ext_dir" == "$volatile_ext" ]; then
				is_volatile=true
				break
			fi
		done
		# Only hash if not volatile
		if [ "$is_volatile" == "false" ]; then
			TREE_HASH=$(git rev-parse "HEAD:$ext_dir" 2>/dev/null || echo "no-tree")
			GIT_TREE_HASH="${GIT_TREE_HASH}${TREE_HASH}"
		fi
	done
	GIT_TREE_HASH=$(echo "$GIT_TREE_HASH" | sha256sum | cut -d' ' -f1)
else
	# No filter - hash entire extensions directory
	GIT_TREE_HASH=$(git rev-parse HEAD:extensions 2>/dev/null || echo "no-git-tree")
fi

# Get all submodule commit SHAs (sorted for determinism, filtered if specified)
SUBMODULE_SHAS=""
if [ -n "$SUBMODULE_PATHS" ]; then
	while IFS= read -r submodule_path; do
		if [ -n "$submodule_path" ]; then
			# Apply filter to submodules if specified
			should_include=true
			if [ "$FILTER" == "volatile" ]; then
				# Only include submodules in volatile extensions
				should_include=false
				for volatile_ext in "${VOLATILE_EXTENSIONS[@]}"; do
					if [[ "$submodule_path" == "$volatile_ext"* ]]; then
						should_include=true
						break
					fi
				done
			elif [ "$FILTER" == "stable" ]; then
				# Exclude submodules in volatile extensions
				for volatile_ext in "${VOLATILE_EXTENSIONS[@]}"; do
					if [[ "$submodule_path" == "$volatile_ext"* ]]; then
						should_include=false
						break
					fi
				done
			fi

			if [ "$should_include" == "true" ]; then
				# Get the commit SHA that the submodule is pinned to in the main repo
				SHA=$(git ls-tree HEAD "$submodule_path" 2>/dev/null | awk '{print $3}')
				if [ -z "$SHA" ]; then
					echo "::warning::Could not read submodule commit SHA for $submodule_path - may not be initialized"
					SHA="uninitialized"
				fi
				SUBMODULE_SHAS="${SUBMODULE_SHAS}${submodule_path}:${SHA},"
			fi
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

# Log what was hashed
FILTER_DESC=""
if [ "$FILTER" == "volatile" ]; then
	FILTER_DESC=" [VOLATILE: python, assistant, r]"
elif [ "$FILTER" == "stable" ]; then
	FILTER_DESC=" [STABLE: all except python, assistant, r]"
fi
echo "Generated extensions hash$FILTER_DESC: $EXTENSIONS_HASH (files: $FILES_HASH, git-tree: $GIT_TREE_HASH, submodules: ${SUBMODULE_SHAS:-none})"
