#!/usr/bin/env bash
# cache-paths.sh
#
# Single source of truth for cache path configuration.
# This file is used by:
#   - restore-build-caches/action.yml
#   - save-build-caches/action.yml
#   - check-uncached-artifacts.sh (to ignore already-cached paths)
#
# When adding new cache paths, update this file only.

# npm core dependencies cache paths
# "The main stuff we need" - All the JavaScript packages for building and testing Positron
# Includes: root node_modules, build packages, remote packages, test packages, and npm cache
# Invalidates when: any core package-lock.json changes
# Note: node-gyp cache location varies by platform - set dynamically below
if [[ "${RUNNER_OS:-}" == "Windows" ]] || [[ "${OS:-}" == "Windows_NT" ]]; then
	# Windows: node-gyp cache is in LOCALAPPDATA
	NODE_GYP_CACHE="${LOCALAPPDATA:-${USERPROFILE}/AppData/Local}/node-gyp"
else
	# Linux/macOS: node-gyp cache is in ~/.cache
	NODE_GYP_CACHE="$HOME/.cache/node-gyp"
fi

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


# Built-in extensions cache paths
# "The built-in VS Code extensions we download" - Pre-made extensions from the VS Code marketplace
# Includes: Downloaded built-in extensions specified in product.json
# Invalidates when: product.json changes (which lists what extensions to download)
read -r -d '' BUILTINS_PATHS << 'EOF' || true
.build/builtInExtensions
EOF

# Playwright browsers cache paths
# "Playwright browser binaries" - Chromium, Firefox, WebKit browsers for E2E testing
# Invalidates when: @playwright/test version changes in package.json
# Note: We cache all browsers (~900MB) but could reduce to just Chromium (~450MB) if needed
# Location varies by platform - set dynamically below
PLAYWRIGHT_PATHS=""
if [[ "${RUNNER_OS:-}" == "Windows" ]] || [[ "${OS:-}" == "Windows_NT" ]]; then
	# Windows: Use LOCALAPPDATA or USERPROFILE
	PLAYWRIGHT_CACHE_DIR="${LOCALAPPDATA:-${USERPROFILE}/AppData/Local}/ms-playwright"
	PLAYWRIGHT_PATHS="$PLAYWRIGHT_CACHE_DIR"
else
	# Linux/macOS: Use ~/.cache
	PLAYWRIGHT_PATHS="$HOME/.cache/ms-playwright"
fi

# npm extensions volatile cache paths (generated dynamically from dirs.js SSOT)
# "The frequently-changing extensions" - Entire directories for python, assistant, r
# Strategy: Cache ENTIRE extension directories (source code + node_modules + resources)
# Invalidates when: ANY file in these extensions changes
# Why entire directories? Simpler, no overlap with stable cache, includes all resources
generate_npm_extensions_volatile_paths() {
	# Read volatile extension list from SSOT (build/npm/dirs.js)
	local volatile_exts
	volatile_exts=$(node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")

	# Generate entire directory paths for each volatile extension
	local paths=""
	while IFS= read -r ext; do
		if [ -n "$ext" ]; then
			# Cache entire directory (includes node_modules, resources, source code, everything)
			paths="${paths}${ext}"$'\n'
		fi
	done <<< "$volatile_exts"

	echo "$paths"
}

# npm extensions stable cache paths (all extensions except volatile)
# "The rarely-changing extensions" - Entire directories for all non-volatile extensions
# Strategy: Cache ENTIRE extension directories (source code + node_modules + resources)
# Invalidates when: ANY file in non-volatile extensions changes
# Why entire directories? Simpler, clean separation from volatile, no wildcard overlap
generate_npm_extensions_stable_paths() {
	# Read volatile extension list from SSOT (build/npm/dirs.js)
	local volatile_exts
	volatile_exts=$(node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")

	# Convert to grep pattern for exclusion
	local volatile_pattern=""
	while IFS= read -r ext; do
		if [ -n "$ext" ]; then
			# Extract just the extension name (e.g., "extensions/positron-python" -> "positron-python")
			local ext_name="${ext##*/}"
			if [ -z "$volatile_pattern" ]; then
				volatile_pattern="$ext_name"
			else
				volatile_pattern="$volatile_pattern|$ext_name"
			fi
		fi
	done <<< "$volatile_exts"

	# Find all extension directories except volatile ones
	local paths=""
	for ext_dir in extensions/*/; do
		ext_dir="${ext_dir%/}"  # Remove trailing slash
		local ext_name="${ext_dir##*/}"

		# Check if this extension is volatile (skip if it is)
		if ! echo "$ext_name" | grep -qE "^($volatile_pattern)$"; then
			# Cache entire directory
			paths="${paths}${ext_dir}"$'\n'
		fi
	done

	# Add .vscode extensions (cache entire directories)
	for vscode_ext_dir in .vscode/extensions/*/; do
		if [ -d "$vscode_ext_dir" ]; then
			vscode_ext_dir="${vscode_ext_dir%/}"
			paths="${paths}${vscode_ext_dir}"$'\n'
		fi
	done

	echo "$paths"
}

# Export for use in scripts
export NPM_CORE_PATHS
export BUILTINS_PATHS
export PLAYWRIGHT_PATHS

# Generate and export split cache paths
NPM_EXTENSIONS_VOLATILE_PATHS=$(generate_npm_extensions_volatile_paths)
NPM_EXTENSIONS_STABLE_PATHS=$(generate_npm_extensions_stable_paths)
export NPM_EXTENSIONS_VOLATILE_PATHS
export NPM_EXTENSIONS_STABLE_PATHS

# Function to get paths as YAML-formatted multiline string (for direct use in actions)
get_npm_core_paths_yaml() {
	echo "$NPM_CORE_PATHS"
}

get_builtins_paths_yaml() {
	echo "$BUILTINS_PATHS"
}

get_playwright_paths_yaml() {
	echo "$PLAYWRIGHT_PATHS"
}

# Function to output all paths to GITHUB_OUTPUT (for use in GitHub Actions)
output_to_github_actions() {
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		# Use delimiter to handle multiline strings safely
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


# If sourced, just export variables. If executed, print for debugging.
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
