#!/usr/bin/env bash
set -euo pipefail

# configure-npm-cache.sh
#
# Configures npm cache directory based on the platform (Linux vs Windows).
# Sets appropriate environment variables for GitHub Actions workflows.
#
# This script provides a single source of truth for npm cache configuration,
# eliminating duplication between Linux and Windows cache action files.
#
# Platform Detection:
#   - Linux: Uses .npm-cache in repo root + configures pip cache
#   - Windows: Uses .npm-cache in repo root (same as Linux for consistency)
#
# Environment Variables Set:
#   - NPM_CONFIG_CACHE: npm cache directory
#   - PIP_CACHE_DIR: Python pip cache directory (Linux only)
#
# Exit Codes:
#   0: Success
#   1: Unsupported platform

detect_platform() {
	if [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "darwin"* ]]; then
		echo "linux"
	elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
		echo "windows"
	elif [[ -n "${RUNNER_OS:-}" ]]; then
		# Fallback to GitHub Actions RUNNER_OS
		case "$RUNNER_OS" in
			Linux|macOS)
				echo "linux"
				;;
			Windows)
				echo "windows"
				;;
			*)
				echo "unknown"
				;;
		esac
	else
		echo "unknown"
	fi
}

PLATFORM=$(detect_platform)

if [[ "$PLATFORM" == "linux" ]]; then
	# Linux configuration
	echo "Configuring npm cache for Linux..."
	NPM_CACHE_PATH=".npm-cache"
	PIP_CACHE_PATH=".pip-cache"

	# Set environment variables for GitHub Actions
	echo "NPM_CONFIG_CACHE=$NPM_CACHE_PATH" >> "$GITHUB_ENV"
	echo "PIP_CACHE_DIR=$PIP_CACHE_PATH" >> "$GITHUB_ENV"

	# Create cache directories
	mkdir -p "$NPM_CACHE_PATH" "$PIP_CACHE_PATH" .versions

	echo "✅ Configured npm cache: $NPM_CACHE_PATH"
	echo "✅ Configured pip cache: $PIP_CACHE_PATH"

elif [[ "$PLATFORM" == "windows" ]]; then
	# Windows configuration
	# IMPORTANT: Use workspace-relative path (same as Linux) for consistency
	# This allows both platforms to use identical cache paths in action.yml
	# Note: .npm-cache works correctly on Windows (no need for AppData/Roaming)
	echo "Configuring npm cache for Windows..."
	NPM_CACHE_PATH=".npm-cache"

	# Set environment variable for GitHub Actions
	echo "NPM_CONFIG_CACHE=$NPM_CACHE_PATH" >> "$GITHUB_ENV"

	echo "✅ Configured npm cache: $NPM_CACHE_PATH"

else
	echo "Error: Unsupported platform: $PLATFORM" >&2
	exit 1
fi
