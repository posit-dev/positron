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
read -r -d '' NPM_CORE_PATHS << 'EOF' || true
.npm-cache
node_modules
build/node_modules
remote/node_modules
remote/web/node_modules
remote/reh-web/node_modules
test/integration/browser/node_modules
test/monaco/node_modules
test/mcp/node_modules
EOF

# npm extensions cache paths
# "The extra extensions stuff" - Packages and resources for Positron-specific extensions
# Includes: extension node_modules, Python tools, assistant resources, etc.
# Invalidates when: extension package.json OR source code OR submodule commits change
read -r -d '' NPM_EXTENSIONS_PATHS << 'EOF' || true
extensions/**/node_modules
.vscode/**/node_modules
extensions/positron-assistant/resources
extensions/positron-python/python-env-tools
extensions/positron-python/python_files
EOF

# Built-in extensions cache paths
# "The built-in VS Code extensions we download" - Pre-made extensions from the VS Code marketplace
# Includes: Downloaded built-in extensions specified in product.json
# Invalidates when: product.json changes (which lists what extensions to download)
read -r -d '' BUILTINS_PATHS << 'EOF' || true
.build/builtInExtensions
EOF

# npm extensions volatile cache paths (generated dynamically from dirs.js SSOT)
# "The frequently-changing extensions" - python, assistant, r node_modules
# Invalidates when: volatile extension package.json OR source code changes
generate_npm_extensions_volatile_paths() {
	# Read volatile extension list from SSOT (build/npm/dirs.js)
	local volatile_exts
	volatile_exts=$(node -e "const {volatileExtensions} = require('./build/npm/dirs.js'); console.log(volatileExtensions.join('\n'))")

	# Generate node_modules paths for each volatile extension
	local paths=""
	while IFS= read -r ext; do
		if [ -n "$ext" ]; then
			paths="${paths}${ext}/node_modules"$'\n'
		fi
	done <<< "$volatile_exts"

	echo "$paths"
}

# npm extensions stable cache paths (all extensions except volatile)
# "The rarely-changing extensions" - All non-volatile extensions + resources
# Invalidates when: stable extension package.json OR source code OR submodules change
# Note: Uses wildcard patterns to catch all extensions automatically
generate_npm_extensions_stable_paths() {
	# Use the same paths as NPM_EXTENSIONS_PATHS
	# This will include ALL extension node_modules (including volatile ones)
	# But in practice, volatile extensions will be restored separately first
	echo "$NPM_EXTENSIONS_PATHS"
}

# Export for use in scripts
export NPM_CORE_PATHS
export NPM_EXTENSIONS_PATHS
export BUILTINS_PATHS

# Generate and export split cache paths
NPM_EXTENSIONS_VOLATILE_PATHS=$(generate_npm_extensions_volatile_paths)
NPM_EXTENSIONS_STABLE_PATHS=$(generate_npm_extensions_stable_paths)
export NPM_EXTENSIONS_VOLATILE_PATHS
export NPM_EXTENSIONS_STABLE_PATHS

# Function to get paths as YAML-formatted multiline string (for direct use in actions)
get_npm_core_paths_yaml() {
	echo "$NPM_CORE_PATHS"
}

get_npm_extensions_paths_yaml() {
	echo "$NPM_EXTENSIONS_PATHS"
}

get_builtins_paths_yaml() {
	echo "$BUILTINS_PATHS"
}

# Function to output all paths to GITHUB_OUTPUT (for use in GitHub Actions)
output_to_github_actions() {
	if [ -n "${GITHUB_OUTPUT:-}" ]; then
		# Use delimiter to handle multiline strings safely
		{
			echo "npm-core-paths<<EOF"
			echo "$NPM_CORE_PATHS"
			echo "EOF"
			echo "npm-extensions-paths<<EOF"
			echo "$NPM_EXTENSIONS_PATHS"
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
		} >> "$GITHUB_OUTPUT"
	fi
}

# Function to get paths as array (for bash scripts)
get_npm_extensions_patterns() {
	# Returns patterns for grep/matching in check-uncached-artifacts.sh
	# Convert paths to patterns (wildcards become regex-friendly)
	echo "$NPM_EXTENSIONS_PATHS" | sed 's/\*\*\///' | sed 's/\*//'
}

# If sourced, just export variables. If executed, print for debugging.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	echo "=== NPM Core Paths ==="
	echo "$NPM_CORE_PATHS"
	echo ""
	echo "=== NPM Extensions Paths (legacy) ==="
	echo "$NPM_EXTENSIONS_PATHS"
	echo ""
	echo "=== NPM Extensions Volatile Paths (generated from dirs.js) ==="
	echo "$NPM_EXTENSIONS_VOLATILE_PATHS"
	echo ""
	echo "=== NPM Extensions Stable Paths ==="
	echo "$NPM_EXTENSIONS_STABLE_PATHS"
	echo ""
	echo "=== Builtins Paths ==="
	echo "$BUILTINS_PATHS"
fi
