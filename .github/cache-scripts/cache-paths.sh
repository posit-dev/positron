#!/usr/bin/env bash
# ============================================================================
# cache-paths.sh - CI Cache Configuration (Single Source of Truth)
# ============================================================================
#
# WHAT THIS FILE DOES:
# Defines what directories/files are cached in CI to speed up builds.
# All cache paths are configured HERE and loaded dynamically by workflows.
#
# CACHING STRATEGY (Directory-Level Caching):
# • npm-core: Root dependencies, build tools, npm/node-gyp caches
# • npm-extensions-volatile: Frequently-changing extensions (python, assistant, r)
# • npm-extensions-stable: All other extensions (change rarely)
# • builtins: Pre-built VS Code extensions from marketplace
# • playwright: Browser binaries for E2E testing
#
# ADDING/MODIFYING CACHES:
# 1. For core/build paths: Edit NPM_CORE_PATHS below
# 2. For volatile extensions: Edit build/npm/dirs.js (volatileExtensions array)
# 3. For stable extensions: Automatic (all non-volatile extensions)
# 4. Run: .github/cache-scripts/verify-cache-paths.sh to validate changes
#
# USED BY:
# • .github/actions/restore-build-caches/action.yml
# • .github/actions/save-build-caches/action.yml
# • .github/cache-scripts/check-uncached-artifacts.sh
#
# ============================================================================

set -euo pipefail

# Find repository root (needed for Node.js require() to find build/npm/dirs.js)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ============================================================================
# SECTION 1: Platform Detection
# ============================================================================
# Cache locations vary by OS. Detect platform and set appropriate paths.

# Detect Windows
IS_WINDOWS=false
if [[ "${RUNNER_OS:-}" == "Windows" ]] || [[ "${OS:-}" == "Windows_NT" ]]; then
	IS_WINDOWS=true
fi

# Set platform-specific cache directories
if [[ "$IS_WINDOWS" == "true" ]]; then
	# Windows paths
	NODE_GYP_CACHE="${LOCALAPPDATA:-${USERPROFILE}/AppData/Local}/node-gyp"
	PLAYWRIGHT_CACHE="${LOCALAPPDATA:-${USERPROFILE}/AppData/Local}/ms-playwright"
else
	# Linux/macOS paths
	# Use workspace-relative paths for Docker container compatibility
	# (Docker containers have different $HOME than host, breaking cache visibility)
	NODE_GYP_CACHE=".node-gyp-cache"
	PLAYWRIGHT_CACHE=".playwright-browsers"
fi

# ============================================================================
# SECTION 2: Cache Path Definitions
# ============================================================================
# Define what gets cached. Paths are relative to repo root unless absolute.

# ----------------------------------------------------------------------------
# npm-core: Core build dependencies (~500MB-1GB)
# ----------------------------------------------------------------------------
# What: Root node_modules, build tools, test dependencies, npm/node-gyp caches
# Invalidates: When any core package-lock.json changes OR Node.js version changes
# Why cache node-gyp: Avoids downloading Node.js headers (saves 10-30s, more reliable)
# Node.js version: Included in cache key to prevent ABI incompatibilities with native modules
read -r -d '' NPM_CORE_PATHS << EOF || true
.npm-cache
$NODE_GYP_CACHE
node_modules
build/node_modules
remote/node_modules
remote/web/node_modules
remote/reh-web/node_modules
test/integration/browser/node_modules
test/monaco/node_modules
test/mcp/node_modules
EOF

# ----------------------------------------------------------------------------
# builtins: Pre-built VS Code extensions (~50-100MB)
# ----------------------------------------------------------------------------
# What: Downloaded extensions from VS Code marketplace (defined in product.json)
# Invalidates: When product.json changes
# Note: Uses restore-keys for partial hits (common use case)
read -r -d '' BUILTINS_PATHS << 'EOF' || true
.build/builtInExtensions
EOF

# ----------------------------------------------------------------------------
# playwright: Browser binaries (~900MB)
# ----------------------------------------------------------------------------
# What: Chromium, Firefox, WebKit browsers for E2E testing
# Invalidates: When @playwright/test version changes
# Note: Browsers are large but rarely change, big time saver
PLAYWRIGHT_PATHS="$PLAYWRIGHT_CACHE"

# ============================================================================
# SECTION 3: Extension Caching (Volatile/Stable Split)
# ============================================================================
# Extensions are split into two caches based on change frequency.
# This optimizes cache hit rates and reduces unnecessary invalidation.

# ----------------------------------------------------------------------------
# npm-extensions-volatile: Frequently-changing extensions (~1GB)
# ----------------------------------------------------------------------------
# What: Entire directories for python, assistant, r extensions
# Why: These change in 71% of PRs, so cache them separately
# Includes: node_modules, source code, resources (python_files, copilot, etc.)
# Invalidates: When ANY file in these extensions changes
# SSOT: build/npm/dirs.js (volatileExtensions array)
generate_npm_extensions_volatile_paths() {
	local volatile_exts
	volatile_exts=$(cd "$REPO_ROOT" && node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")

	local paths=""
	while IFS= read -r ext; do
		if [ -n "$ext" ]; then
			paths="${paths}${ext}"$'\n'
		fi
	done <<< "$volatile_exts"

	echo "$paths"
}

# ----------------------------------------------------------------------------
# npm-extensions-stable: Rarely-changing extensions (~2-3GB)
# ----------------------------------------------------------------------------
# What: Entire directories for all non-volatile extensions
# Why: These change in only 29% of PRs, big cache but worth it
# Includes: All extensions not in volatileExtensions array
# Invalidates: When ANY file in non-volatile extensions changes
# Note: Automatically discovers extensions (no manual list needed)
generate_npm_extensions_stable_paths() {
	local volatile_exts
	volatile_exts=$(cd "$REPO_ROOT" && node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")

	# Build exclusion pattern from volatile extensions
	local volatile_pattern=""
	while IFS= read -r ext; do
		if [ -n "$ext" ]; then
			local ext_name="${ext##*/}"
			if [ -z "$volatile_pattern" ]; then
				volatile_pattern="$ext_name"
			else
				volatile_pattern="$volatile_pattern|$ext_name"
			fi
		fi
	done <<< "$volatile_exts"

	# Find all extensions except volatile ones and node_modules
	local paths=""
	for ext_dir in extensions/*/; do
		ext_dir="${ext_dir%/}"
		local ext_name="${ext_dir##*/}"

		# Skip node_modules and volatile extensions
		if [ "$ext_name" != "node_modules" ] && ! echo "$ext_name" | grep -qE "^($volatile_pattern)$"; then
			paths="${paths}${ext_dir}"$'\n'
		fi
	done

	# Include shared extensions/node_modules (contains shared deps like esbuild)
	# Always include this path, even if it doesn't exist yet (will be created during npm install)
	paths="${paths}extensions/node_modules"$'\n'

	# Include .vscode extensions
	for vscode_ext_dir in .vscode/extensions/*/; do
		if [ -d "$vscode_ext_dir" ]; then
			vscode_ext_dir="${vscode_ext_dir%/}"
			paths="${paths}${vscode_ext_dir}"$'\n'
		fi
	done

	echo "$paths"
}

# ============================================================================
# SECTION 4: Exports & GitHub Actions Integration
# ============================================================================

# Generate dynamic paths
NPM_EXTENSIONS_VOLATILE_PATHS=$(generate_npm_extensions_volatile_paths)
NPM_EXTENSIONS_STABLE_PATHS=$(generate_npm_extensions_stable_paths)

# Export all cache paths for use in other scripts
export NPM_CORE_PATHS
export NPM_EXTENSIONS_VOLATILE_PATHS
export NPM_EXTENSIONS_STABLE_PATHS
export BUILTINS_PATHS
export PLAYWRIGHT_PATHS

# Output paths to GITHUB_OUTPUT for use in workflows
output_to_github_actions() {
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		{
			echo "npm-core-paths<<EOF"
			echo "$NPM_CORE_PATHS"
			echo "EOF"
			echo "npm-extensions-volatile-paths<<EOF"
			echo "$NPM_EXTENSIONS_VOLATILE_PATHS"
			echo "EOF"
			echo "npm-extensions-stable-paths<<EOF"
			echo "$NPM_EXTENSIONS_STABLE_PATHS"
			echo "EOF"
			echo "builtins-paths<<EOF"
			echo "$BUILTINS_PATHS"
			echo "EOF"
			echo "playwright-paths<<EOF"
			echo "$PLAYWRIGHT_PATHS"
			echo "EOF"
		} >> "$GITHUB_OUTPUT"
	fi
}

# ============================================================================
# SECTION 5: Debug Output
# ============================================================================
# When executed directly (not sourced), print all paths for debugging

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	echo "=== NPM Core Paths ==="
	echo "$NPM_CORE_PATHS"
	echo ""
	echo "=== NPM Extensions Volatile Paths ==="
	echo "$NPM_EXTENSIONS_VOLATILE_PATHS"
	echo ""
	echo "=== NPM Extensions Stable Paths ==="
	echo "$NPM_EXTENSIONS_STABLE_PATHS"
	echo ""
	echo "=== Builtins Paths ==="
	echo "$BUILTINS_PATHS"
	echo ""
	echo "=== Playwright Paths ==="
	echo "$PLAYWRIGHT_PATHS"
fi
