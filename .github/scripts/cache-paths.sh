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
# Invalidates when: extension package.json OR source code OR submodule commits change
read -r -d '' NPM_EXTENSIONS_PATHS << 'EOF' || true
extensions/**/node_modules
.vscode/**/node_modules
extensions/positron-assistant/resources
extensions/positron-python/python-env-tools
extensions/positron-python/python_files
EOF

# Built-in extensions cache paths
# Invalidates when: product.json changes
read -r -d '' BUILTINS_PATHS << 'EOF' || true
.build/builtInExtensions
EOF

# Export for use in scripts
export NPM_CORE_PATHS
export NPM_EXTENSIONS_PATHS
export BUILTINS_PATHS

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
	echo "=== NPM Extensions Paths ==="
	echo "$NPM_EXTENSIONS_PATHS"
	echo ""
	echo "=== Builtins Paths ==="
	echo "$BUILTINS_PATHS"
fi
