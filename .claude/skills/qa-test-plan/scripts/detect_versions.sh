#!/bin/bash
# detect_versions.sh - Fast, silent version detection for Positron and OS
#
# This script attempts to auto-detect:
# 1. Positron version and build number
# 2. OS version
#
# DESIGN PRINCIPLES:
# - Fast: Each detection has a 3-second timeout, max 6 seconds total
# - Silent: Never prints errors, never prompts, only outputs JSON
# - Fail-safe: If detection fails, returns empty values (not errors)
# - Cross-platform: Works on macOS, Linux, Windows (Git Bash/PowerShell)
#
# Output format: JSON with keys:
# - positronVersion: string or empty
# - positronBuild: string or empty
# - osVersion: string or empty
# - detectionStatus: "success", "partial", or "failed"

set +e  # Don't exit on errors
set -u  # But do error on undefined variables
set -o pipefail

# Timeout for each detection attempt (seconds)
TIMEOUT=2

# Colors for debug output (only used if DEBUG=1)
if [ "${DEBUG:-0}" = "1" ]; then
	RED='\033[0;31m'
	GREEN='\033[0;32m'
	YELLOW='\033[1;33m'
	NC='\033[0m'
else
	RED=''
	GREEN=''
	YELLOW=''
	NC=''
fi

debug() {
	if [ "${DEBUG:-0}" = "1" ]; then
		echo -e "${YELLOW}[DEBUG]${NC} $1" >&2
	fi
}

# Detect platform
detect_platform() {
	case "$(uname -s)" in
		Darwin*) echo "macos" ;;
		Linux*) echo "linux" ;;
		CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
		*) echo "unknown" ;;
	esac
}

PLATFORM=$(detect_platform)
debug "Platform: $PLATFORM"

# Function to run command with timeout (silent on failure)
run_with_timeout() {
	local timeout=$1
	shift
	local cmd="$@"

	debug "Running: $cmd"

	# Try with timeout command if available, otherwise just run directly
	if command -v timeout >/dev/null 2>&1; then
		timeout "$timeout" bash -c "$cmd" 2>/dev/null
	elif command -v gtimeout >/dev/null 2>&1; then
		# macOS with coreutils installed
		gtimeout "$timeout" bash -c "$cmd" 2>/dev/null
	else
		# No timeout available, just run directly (risky but better than nothing)
		eval "$cmd" 2>/dev/null
	fi
	return $?
}

# Detect Positron version
detect_positron_version() {
	local product_json=""
	local positron_version=""
	local positron_build=""

	# List of paths to check (in order of likelihood)
	case "$PLATFORM" in
		macos)
			paths=(
				"/Applications/Positron.app/Contents/Resources/app/product.json"
				"$HOME/Applications/Positron.app/Contents/Resources/app/product.json"
			)
			;;
		linux)
			paths=(
				"/usr/share/positron/resources/app/product.json"
				"/opt/positron/resources/app/product.json"
				"$HOME/.local/share/positron/resources/app/product.json"
				"$HOME/positron/resources/app/product.json"
			)
			;;
		windows)
			# Convert Windows paths for Git Bash/MSYS
			localappdata="${LOCALAPPDATA:-$HOME/AppData/Local}"
			programfiles="${PROGRAMFILES:-/c/Program Files}"
			programfilesx86="${PROGRAMFILES(X86):-/c/Program Files (x86)}"

			paths=(
				"$localappdata/Programs/Positron/resources/app/product.json"
				"$programfiles/Positron/resources/app/product.json"
				"$programfilesx86/Positron/resources/app/product.json"
			)
			;;
		*)
			paths=()
			;;
	esac

	# Try each path with timeout
	for path in "${paths[@]}"; do
		debug "Checking path: $path"

		# Check if file exists quickly (no timeout needed)
		if [ -f "$path" ]; then
			debug "File exists, reading..."

			# Read and parse JSON with timeout
			if command -v jq >/dev/null 2>&1; then
				local result=$(run_with_timeout $TIMEOUT "cat '$path' | jq -r '{positronVersion:.positronVersion, positronBuildNumber:.positronBuildNumber}'")

				if [ $? -eq 0 ] && [ -n "$result" ]; then
					positron_version=$(echo "$result" | jq -r '.positronVersion // empty' 2>/dev/null)
					positron_build=$(echo "$result" | jq -r '.positronBuildNumber // empty' 2>/dev/null)

					if [ -n "$positron_version" ] && [ "$positron_version" != "null" ]; then
						debug "Found version: $positron_version build $positron_build"
						break
					fi
				fi
			else
				# Fallback: try to extract without jq (less reliable)
				local result=$(run_with_timeout $TIMEOUT "grep -E 'positronVersion|positronBuildNumber' '$path' | head -2")

				if [ $? -eq 0 ] && [ -n "$result" ]; then
					positron_version=$(echo "$result" | grep positronVersion | sed -E 's/.*"positronVersion"[^"]*"([^"]+)".*/\1/' | head -1)
					positron_build=$(echo "$result" | grep positronBuildNumber | sed -E 's/.*"positronBuildNumber"[^"]*"?([^",]+)"?.*/\1/' | head -1)

					if [ -n "$positron_version" ]; then
						debug "Found version (no jq): $positron_version build $positron_build"
						break
					fi
				fi
			fi
		fi
	done

	# Output results (even if empty)
	echo "$positron_version"
	echo "$positron_build"
}

# Detect OS version
detect_os_version() {
	local os_version=""

	case "$PLATFORM" in
		macos)
			debug "Detecting macOS version..."
			os_version=$(run_with_timeout $TIMEOUT "sw_vers -productVersion 2>/dev/null | head -1")
			if [ -n "$os_version" ]; then
				os_version="macOS $os_version"
			fi
			;;
		linux)
			debug "Detecting Linux version..."
			# Try /etc/os-release first (standard)
			if [ -f /etc/os-release ]; then
				local name=$(run_with_timeout $TIMEOUT "grep -E '^NAME=' /etc/os-release | cut -d'=' -f2 | tr -d '\"' | head -1")
				local version=$(run_with_timeout $TIMEOUT "grep -E '^VERSION_ID=' /etc/os-release | cut -d'=' -f2 | tr -d '\"' | head -1")

				if [ -n "$name" ]; then
					os_version="$name"
					if [ -n "$version" ]; then
						os_version="$os_version $version"
					fi
				fi
			fi

			# Fallback to uname
			if [ -z "$os_version" ]; then
				os_version=$(run_with_timeout $TIMEOUT "uname -sr 2>/dev/null")
			fi
			;;
		windows)
			debug "Detecting Windows version..."
			# Try multiple methods for Windows

			# Method 1: PowerShell command (if available)
			if command -v powershell.exe >/dev/null 2>&1; then
				local win_version=$(run_with_timeout $TIMEOUT "powershell.exe -NoProfile -Command '[System.Environment]::OSVersion.VersionString' 2>/dev/null | tr -d '\r'")
				if [ -n "$win_version" ]; then
					os_version="$win_version"
				fi
			fi

			# Method 2: Try systeminfo (slower, skip if we have version)
			if [ -z "$os_version" ] && command -v systeminfo >/dev/null 2>&1; then
				local win_name=$(run_with_timeout $TIMEOUT "systeminfo 2>/dev/null | grep -E 'OS Name' | cut -d':' -f2 | sed 's/^[[:space:]]*//' | head -1")
				if [ -n "$win_name" ]; then
					os_version="$win_name"
				fi
			fi

			# Fallback: uname (less informative on Windows)
			if [ -z "$os_version" ]; then
				os_version=$(run_with_timeout $TIMEOUT "uname -sr 2>/dev/null")
			fi
			;;
		*)
			os_version=$(run_with_timeout $TIMEOUT "uname -sr 2>/dev/null")
			;;
	esac

	# Trim whitespace
	os_version=$(echo "$os_version" | xargs 2>/dev/null)

	debug "OS Version: $os_version"
	echo "$os_version"
}

# Main detection logic
main() {
	debug "Starting version detection..."

	# Detect Positron version (returns two lines)
	local positron_output=$(detect_positron_version)
	local positron_version=$(echo "$positron_output" | sed -n '1p')
	local positron_build=$(echo "$positron_output" | sed -n '2p')

	# Detect OS version
	local os_version=$(detect_os_version)

	# Determine detection status
	local status="failed"
	if [ -n "$positron_version" ] && [ -n "$os_version" ]; then
		status="success"
	elif [ -n "$positron_version" ] || [ -n "$os_version" ]; then
		status="partial"
	fi

	# Output JSON (always valid, even if empty)
	cat <<-EOF
	{
	  "positronVersion": "${positron_version:-}",
	  "positronBuild": "${positron_build:-}",
	  "osVersion": "${os_version:-}",
	  "detectionStatus": "$status"
	}
	EOF

	debug "Detection complete: $status"
}

# Run main function
main
