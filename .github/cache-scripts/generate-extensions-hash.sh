#!/usr/bin/env bash
# ============================================================================
# generate-extensions-hash.sh - Cache Key Generator for Extensions
# ============================================================================
#
# WHAT THIS DOES:
# Creates a deterministic hash used as the cache key for npm-extensions caches.
# When the hash changes, the cache invalidates and extensions are reinstalled.
#
# WHY WE NEED THIS:
# Extensions change in different ways that should all trigger cache invalidation:
# • Dependencies change (package.json updated)
# • Source code changes (TypeScript, configs, etc.)
# • Git submodules update (vendored dependencies like copilot-chat)
#
# Simple solution: Hash everything and invalidate on any change!
#
# CACHING STRATEGY (Volatile/Stable Split):
#
# VOLATILE CACHE (~1GB):
#   • Extensions: python, assistant, r
#   • Change frequency: 71% of PRs (1,282 changes / 6 months)
#   • Invalidates often but fast to rebuild
#   • NOTE: Extension list defined in build/npm/dirs.js (single source of truth)
#
# STABLE CACHE (~2-3GB):
#   • Extensions: All others (~25+ extensions)
#   • Change frequency: 29% of PRs (~418 changes / 6 months)
#   • Invalidates rarely, big CI time savings
#
# SINGLE SOURCE OF TRUTH:
# Volatile extension list: build/npm/dirs.js (volatileExtensions array)
# This script reads from that file - never modify the list here!
#
# NODE.JS VERSION:
# Extension caches do NOT include Node.js version in keys (unlike npm-core).
# Why? They already invalidate on ANY source code change (git tree hash),
# so stale node-gyp artifacts are automatically cleared. npm-core needs explicit
# Node.js version protection because it only invalidates on package-lock changes.
#
# USAGE:
# ./generate-extensions-hash.sh [--filter volatile|stable]
#   --filter volatile  → Hash only python/assistant/r
#   --filter stable    → Hash all except python/assistant/r
#   (no filter)        → Hash all extensions (legacy)
#
# OUTPUT:
# Writes "hash=<sha256>" to $GITHUB_OUTPUT for use in cache keys
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Parse Arguments
# ============================================================================

FILTER=""
while [[ $# -gt 0 ]]; do
	case $1 in
		--filter)
			FILTER="$2"
			shift 2
			;;
		*)
			echo "❌ Unknown option: $1"
			echo "Usage: $0 [--filter volatile|stable]"
			exit 1
			;;
	esac
done

# ============================================================================
# SECTION 2: Load Configuration
# ============================================================================
# Load volatile extensions list from single source of truth (build/npm/dirs.js).
# This ensures we never get out of sync between this script and the actual build.

VOLATILE_EXTENSIONS_RAW=$(node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")

# Convert to bash array for easier processing
VOLATILE_EXTENSIONS=()
while IFS= read -r line; do
	VOLATILE_EXTENSIONS+=("$line")
done <<< "$VOLATILE_EXTENSIONS_RAW"

echo "Loaded ${#VOLATILE_EXTENSIONS[@]} volatile extensions from build/npm/dirs.js"

# Get all git submodules in extensions/ and .vscode/
# (e.g., positron-copilot-chat is a submodule we need to track)
SUBMODULE_PATHS=$(git config --file .gitmodules --get-regexp path | grep -E '(extensions/|\.vscode/)' | awk '{print $2}' || echo "")

# Build find exclusion arguments to skip submodule directories
# (We'll hash submodule commit SHAs separately in Section 5)
FIND_EXCLUDES=""
if [ -n "$SUBMODULE_PATHS" ]; then
	while IFS= read -r submodule_path; do
		if [ -n "$submodule_path" ]; then
			FIND_EXCLUDES="$FIND_EXCLUDES ! -path \"*/${submodule_path#*/}/*\""
		fi
	done <<< "$SUBMODULE_PATHS"
fi

# ============================================================================
# SECTION 3: Hash Component 1 - package.json Files
# ============================================================================
# Hash all package.json files to detect dependency changes.
#
# Why package.json and not package-lock.json?
# Lock files are modified during npm install (postinstall updates), making them
# unsuitable for cache keys. package.json only changes when dependencies are
# intentionally added/removed/updated.

echo "Hashing package.json files..."

if [ "$FILTER" == "volatile" ]; then
	echo "  → Filtering: volatile extensions only"
	FILTER_PATTERN=$(IFS='|'; echo "${VOLATILE_EXTENSIONS[*]}")
	FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f -not -path \"*/node_modules/*\" $FIND_EXCLUDES 2>/dev/null" | grep -E "($FILTER_PATTERN)" | sort | xargs cat 2>/dev/null | sha256sum | cut -d' ' -f1)
elif [ "$FILTER" == "stable" ]; then
	echo "  → Filtering: stable extensions only"
	FILTER_PATTERN=$(IFS='|'; echo "${VOLATILE_EXTENSIONS[*]}")
	FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f -not -path \"*/node_modules/*\" $FIND_EXCLUDES 2>/dev/null" | grep -v -E "($FILTER_PATTERN)" | sort | xargs cat 2>/dev/null | sha256sum | cut -d' ' -f1)
else
	echo "  → No filter: all extensions"
	FILES_HASH=$(eval "find extensions .vscode -maxdepth 3 -name \"package.json\" -type f -not -path \"*/node_modules/*\" $FIND_EXCLUDES 2>/dev/null" | sort | xargs cat 2>/dev/null | sha256sum | cut -d' ' -f1)
fi

echo "  ✓ package.json hash: $FILES_HASH"

# ============================================================================
# SECTION 4: Hash Component 2 - Git Tree (Source Code)
# ============================================================================
# Hash git tree objects to detect source code changes.
#
# Why git tree hash?
# Git's tree hash changes whenever ANY file in a directory changes. This is
# more efficient than hashing file contents and automatically handles adds/
# deletes/renames. Forces cache invalidation when source code changes, not
# just when dependencies change.

echo "Hashing git tree objects..."

if [ "$FILTER" == "volatile" ]; then
	echo "  → Filtering: volatile extensions only"
	GIT_TREE_HASH=""
	for ext in "${VOLATILE_EXTENSIONS[@]}"; do
		TREE_HASH=$(git rev-parse "HEAD:$ext" 2>/dev/null || echo "no-tree")
		GIT_TREE_HASH="${GIT_TREE_HASH}${TREE_HASH}"
	done
	GIT_TREE_HASH=$(echo "$GIT_TREE_HASH" | sha256sum | cut -d' ' -f1)
elif [ "$FILTER" == "stable" ]; then
	echo "  → Filtering: stable extensions only"
	ALL_EXT_DIRS=$(find extensions -maxdepth 1 -type d -not -name "node_modules" | tail -n +2 | sort)
	GIT_TREE_HASH=""
	for ext_dir in $ALL_EXT_DIRS; do
		# Check if this is a volatile extension (skip if it is)
		is_volatile=false
		for volatile_ext in "${VOLATILE_EXTENSIONS[@]}"; do
			if [ "$ext_dir" == "$volatile_ext" ]; then
				is_volatile=true
				break
			fi
		done
		# Only hash non-volatile extensions
		if [ "$is_volatile" == "false" ]; then
			TREE_HASH=$(git rev-parse "HEAD:$ext_dir" 2>/dev/null || echo "no-tree")
			GIT_TREE_HASH="${GIT_TREE_HASH}${TREE_HASH}"
		fi
	done

	# Also hash .vscode/extensions/* (they're in the stable cache too!)
	for vscode_ext_dir in .vscode/extensions/*/; do
		if [ -d "$vscode_ext_dir" ]; then
			vscode_ext_dir="${vscode_ext_dir%/}"
			TREE_HASH=$(git rev-parse "HEAD:$vscode_ext_dir" 2>/dev/null || echo "no-tree")
			GIT_TREE_HASH="${GIT_TREE_HASH}${TREE_HASH}"
		fi
	done

	GIT_TREE_HASH=$(echo "$GIT_TREE_HASH" | sha256sum | cut -d' ' -f1)
else
	echo "  → No filter: entire extensions directory"
	# Hash entire extensions directory, but git will naturally exclude node_modules from tree object
	GIT_TREE_HASH=$(git rev-parse HEAD:extensions 2>/dev/null || echo "no-git-tree")
fi

echo "  ✓ git tree hash: $GIT_TREE_HASH"

# ============================================================================
# SECTION 5: Hash Component 3 - Git Submodule Commit SHAs
# ============================================================================
# Hash the commit SHA that each submodule is pinned to.
#
# Why separate from tree hash?
# Submodule files may or may not exist on disk (depends on initialization),
# but the commit SHA is always available in the parent repo's index (git ls-tree).
# This ensures deterministic hashing regardless of submodule checkout state.
#
# Example: positron-copilot-chat submodule is vendored. When it updates to a
# new commit, we need to invalidate the cache even if local files aren't checked out.

echo "Hashing git submodule commit SHAs..."

SUBMODULE_SHAS=""
if [ -n "$SUBMODULE_PATHS" ]; then
	while IFS= read -r submodule_path; do
		if [ -n "$submodule_path" ]; then
			# Apply filter if specified
			should_include=true
			if [ "$FILTER" == "volatile" ]; then
				# Only include submodules inside volatile extensions
				should_include=false
				for volatile_ext in "${VOLATILE_EXTENSIONS[@]}"; do
					if [[ "$submodule_path" == "$volatile_ext"* ]]; then
						should_include=true
						break
					fi
				done
			elif [ "$FILTER" == "stable" ]; then
				# Exclude submodules inside volatile extensions
				for volatile_ext in "${VOLATILE_EXTENSIONS[@]}"; do
					if [[ "$submodule_path" == "$volatile_ext"* ]]; then
						should_include=false
						break
					fi
				done
			fi

			if [ "$should_include" == "true" ]; then
				# Get the commit SHA that the submodule is pinned to
				SHA=$(git ls-tree HEAD "$submodule_path" 2>/dev/null | awk '{print $3}')
				if [ -z "$SHA" ]; then
					echo "  ⚠️  Could not read submodule SHA for $submodule_path (may not be initialized)"
					SHA="uninitialized"
				fi
				SUBMODULE_SHAS="${SUBMODULE_SHAS}${submodule_path}:${SHA},"
				echo "  → $submodule_path: $SHA"
			fi
		fi
	done <<< "$SUBMODULE_PATHS"
	echo "  ✓ submodule SHAs: ${SUBMODULE_SHAS:-none}"
else
	echo "  → No submodules found"
fi

# ============================================================================
# SECTION 6: Combine & Output Final Hash
# ============================================================================
# Combine all three components into a single deterministic hash.
# This becomes the cache key: npm-extensions-{volatile|stable}-v1-{OS}-{hash}

echo "Generating final hash..."

EXTENSIONS_HASH=$(echo "${FILES_HASH}-${GIT_TREE_HASH}-${SUBMODULE_SHAS}" | sha256sum | cut -d' ' -f1)

# Validate hash is not empty
if [ -z "$EXTENSIONS_HASH" ]; then
	echo "❌ Hash generation failed. Cache will be disabled for this run."
	exit 1
fi

# Output to GITHUB_OUTPUT (if in CI) or stdout (if local)
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	echo "hash=$EXTENSIONS_HASH" >> "$GITHUB_OUTPUT"
fi

# Show human-readable summary
FILTER_DESC=""
if [ "$FILTER" == "volatile" ]; then
	FILTER_DESC=" (VOLATILE: python, assistant, r)"
elif [ "$FILTER" == "stable" ]; then
	FILTER_DESC=" (STABLE: all except python, assistant, r)"
fi

echo ""
echo "✓ Generated extensions hash$FILTER_DESC"
echo "  Final hash: $EXTENSIONS_HASH"
echo "  Components:"
echo "    • package.json: $FILES_HASH"
echo "    • git tree:     $GIT_TREE_HASH"
echo "    • submodules:   ${SUBMODULE_SHAS:-none}"
