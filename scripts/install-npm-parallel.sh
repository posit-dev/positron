#!/usr/bin/env bash
set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# install-npm-parallel.sh
# Installs npm dependencies in parallel for root, build, remote, and test/e2e directories.
# This script is used by CI workflows to speed up dependency installation.

# Ensure npm cache dir exists. The composite action should set NPM_CONFIG_CACHE.
NPM_CONFIG_CACHE=${NPM_CONFIG_CACHE:-.npm-cache}
mkdir -p "$NPM_CONFIG_CACHE"

echo "Installing npm dependencies in parallel using cache: $NPM_CONFIG_CACHE"

# Detect Windows platform
IS_WINDOWS=false
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
	IS_WINDOWS=true
elif [[ -n "${RUNNER_OS:-}" ]] && [[ "$RUNNER_OS" == "Windows" ]]; then
	IS_WINDOWS=true
fi

# On Windows, install core directories sequentially to avoid node-gyp race conditions
# Windows file locking is strict and causes race conditions when:
# 1. remote/ has @vscode/windows-process-tree with native dependencies
# 2. root's postinstall.js installs extensions that share the same native modules
# 3. build/ contains node-gyp and build tools needed by extensions
# Running these sequentially ensures build tools are ready before extensions install
if [ "$IS_WINDOWS" = true ]; then
	echo "Windows detected: Installing core directories sequentially to avoid race conditions"

	# Disable postinstall.js parallel mode on Windows - let this script control parallelism
	export POSITRON_PARALLEL_INSTALL=0

	# Install sequentially to avoid native module build races, checking exit codes
	echo "Installing build dependencies..."
	if ! npm --prefix build ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE"; then
		echo "ERROR: build/ npm ci failed"
		exit 1
	fi

	echo "Installing remote dependencies..."
	if ! npm --prefix remote ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE"; then
		echo "ERROR: remote/ npm ci failed"
		exit 1
	fi

	echo "Installing root dependencies (includes extensions via postinstall)..."
	if ! npm ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE"; then
		echo "ERROR: root npm ci failed"
		exit 1
	fi

	# test/e2e can run separately since it has no native modules
	pids=()
	npm --prefix test/e2e ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
else
	# Linux/Mac: Run all npm ci commands in parallel for faster installation
	pids=()
	npm ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
	npm --prefix build ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
	npm --prefix remote ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
	npm --prefix test/e2e ci --prefer-offline --no-audit --no-fund --fetch-timeout 120000 --cache "$NPM_CONFIG_CACHE" & pids+=($!)
fi

# Wait for all npm ci processes and check exit codes
exit_code=0
for pid in "${pids[@]}"; do
	if ! wait "$pid"; then
		echo "ERROR: npm ci failed for process $pid"
		exit_code=1
	fi
done

if [ $exit_code -ne 0 ]; then
	echo ""
	# allow-any-unicode-next-line
	echo "❌ npm install failed"
	echo ""
	echo "One or more npm ci commands failed. This may be due to:"
	echo "  • Network failures (transient - will retry automatically)"
	echo "  • node-gyp build errors (check logs above for compilation failures)"
	echo "  • Missing system dependencies (build tools, Visual Studio on Windows)"
	echo "  • Package registry issues"
	echo ""
	echo "Check the logs above for specific error messages."
	exit 1
fi

echo ""
# allow-any-unicode-next-line
echo "✅ npm install completed successfully"
echo ""
