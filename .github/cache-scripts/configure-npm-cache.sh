#!/usr/bin/env bash
# ============================================================================
# configure-npm-cache.sh - Platform-Specific Cache Configuration
# ============================================================================
#
# WHAT THIS DOES:
# Configures npm and pip cache directories based on the platform (Linux/Windows).
# Sets environment variables so CI workflows know where to cache dependencies.
#
# WHY WE NEED THIS:
# Different platforms have different default cache locations:
# • Linux/macOS: ~/.npm, ~/.cache/pip
# • Windows: %AppData%/npm-cache, %LocalAppData%/pip
#
# We override these defaults to use workspace-relative paths (.npm-cache,
# .pip-cache) so GitHub Actions can cache them easily. This provides:
# • Consistent paths across platforms
# • Simple cache configuration (no OS-specific logic in workflows)
# • Fast cache restore (workspace-relative paths)
#
# PLATFORM CONFIGURATION:
#
# Linux/macOS:
#   NPM_CONFIG_CACHE=.npm-cache    → npm uses this instead of ~/.npm
#   PIP_CACHE_DIR=.pip-cache       → pip uses this instead of ~/.cache/pip
#
# Windows:
#   NPM_CONFIG_CACHE=.npm-cache    → npm uses this (same as Linux!)
#   (no pip cache - pip not used on Windows CI)
#
# USAGE:
# ./configure-npm-cache.sh
# (No arguments needed - auto-detects platform)
#
# OUTPUT:
# Writes environment variables to $GITHUB_ENV for use in subsequent steps
#
# ============================================================================

set -euo pipefail

# ============================================================================
# SECTION 1: Platform Detection
# ============================================================================
# Detect whether we're running on Linux/macOS or Windows.
# Uses $OSTYPE (bash built-in) or $RUNNER_OS (GitHub Actions) as fallback.

detect_platform() {
	# Try $OSTYPE first (more reliable)
	if [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "darwin"* ]]; then
		echo "linux"
	elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
		echo "windows"
	elif [[ -n "${RUNNER_OS:-}" ]]; then
		# Fallback to GitHub Actions RUNNER_OS environment variable
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

# ============================================================================
# SECTION 2: Configure Cache Directories
# ============================================================================
# Set platform-specific cache paths and environment variables.

if [[ "$PLATFORM" == "linux" ]]; then
	# ----------------------------------------------------------------------------
	# Linux/macOS Configuration
	# ----------------------------------------------------------------------------
	echo "Configuring npm cache for Linux/macOS..."

	NPM_CACHE_PATH=".npm-cache"
	PIP_CACHE_PATH=".pip-cache"

	# Set environment variables for this workflow and subsequent steps
	# GitHub Actions will automatically export these to future steps
	echo "NPM_CONFIG_CACHE=$NPM_CACHE_PATH" >> "$GITHUB_ENV"
	echo "PIP_CACHE_DIR=$PIP_CACHE_PATH" >> "$GITHUB_ENV"

	# Create cache directories (ensures they exist before npm/pip use them)
	mkdir -p "$NPM_CACHE_PATH" "$PIP_CACHE_PATH" .versions

	echo "✅ Configured npm cache: $NPM_CACHE_PATH"
	echo "✅ Configured pip cache: $PIP_CACHE_PATH"
	echo "✅ Created cache directories"

elif [[ "$PLATFORM" == "windows" ]]; then
	# ----------------------------------------------------------------------------
	# Windows Configuration
	# ----------------------------------------------------------------------------
	echo "Configuring npm cache for Windows..."

	NPM_CACHE_PATH=".npm-cache"

	# Use same workspace-relative path as Linux for consistency
	# This allows both platforms to use identical cache configuration in workflows
	# Note: .npm-cache works correctly on Windows (no need for AppData/Roaming)
	echo "NPM_CONFIG_CACHE=$NPM_CACHE_PATH" >> "$GITHUB_ENV"

	# Note: No pip cache on Windows - Python dependencies installed differently
	# (Windows CI uses pre-built wheels, not pip install from source)

	echo "✅ Configured npm cache: $NPM_CACHE_PATH"

else
	# ----------------------------------------------------------------------------
	# Unsupported Platform
	# ----------------------------------------------------------------------------
	echo "❌ Error: Unsupported platform: $PLATFORM" >&2
	echo "   Supported platforms: Linux, macOS, Windows" >&2
	exit 1
fi
