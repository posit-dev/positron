#!/usr/bin/env bash
set -euo pipefail

# verify-binary.sh
#
# Verifies that a binary exists and is functional before caching.
# Handles platform-specific binary paths and extensions.
#
# Usage:
#   verify-binary.sh <binary-type>
#
# Arguments:
#   binary-type: Either "ark" or "kallichore"
#
# Outputs (to GitHub Actions):
#   Sets "verified=true" or "verified=false" in GITHUB_OUTPUT
#
# Exit Codes:
#   0: Verification completed (check GITHUB_OUTPUT for result)
#   1: Invalid binary type

BINARY_TYPE="${1:-}"

if [[ "$BINARY_TYPE" != "ark" && "$BINARY_TYPE" != "kallichore" ]]; then
	echo "Error: Invalid binary type '$BINARY_TYPE'. Must be 'ark' or 'kallichore'." >&2
	exit 1
fi

detect_platform() {
	if [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "darwin"* ]]; then
		echo "linux"
	elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
		echo "windows"
	elif [[ -n "${RUNNER_OS:-}" ]]; then
		case "$RUNNER_OS" in
			Linux|macOS) echo "linux" ;;
			Windows) echo "windows" ;;
			*) echo "unknown" ;;
		esac
	else
		echo "unknown"
	fi
}

PLATFORM=$(detect_platform)

verify_ark() {
	local platform="$1"

	if [[ "$platform" == "linux" ]]; then
		ARK_PATH="extensions/positron-r/resources/ark/ark"
		if [ -f "$ARK_PATH" ] && "$ARK_PATH" --version 2>/dev/null; then
			echo "✅ Ark binary verified and functional"
			echo "verified=true" >> "$GITHUB_OUTPUT"
		else
			echo "⚠️ Ark binary missing or not functional - skipping cache save"
			echo "verified=false" >> "$GITHUB_OUTPUT"
		fi

	elif [[ "$platform" == "windows" ]]; then
		# On Windows, Ark has architecture-specific builds
		ARK_X64="extensions/positron-r/resources/ark/windows-x64/ark.exe"
		ARK_ARM64="extensions/positron-r/resources/ark/windows-arm64/ark.exe"

		local verified=false
		if [ -f "$ARK_X64" ]; then
			echo "✅ Ark x64 binary found"
			verified=true
		else
			echo "⚠️ Ark x64 binary missing"
		fi

		if [ -f "$ARK_ARM64" ]; then
			echo "✅ Ark arm64 binary found"
			verified=true
		else
			echo "⚠️ Ark arm64 binary missing"
		fi

		if $verified; then
			echo "✅ At least one Ark binary verified"
			echo "verified=true" >> "$GITHUB_OUTPUT"
		else
			echo "⚠️ No Ark binaries found - skipping cache save"
			echo "verified=false" >> "$GITHUB_OUTPUT"
		fi

	else
		echo "⚠️ Unknown platform - skipping verification"
		echo "verified=false" >> "$GITHUB_OUTPUT"
	fi
}

verify_kallichore() {
	local platform="$1"

	if [[ "$platform" == "linux" ]]; then
		KC_PATH="extensions/positron-supervisor/resources/kallichore/kcserver"
	elif [[ "$platform" == "windows" ]]; then
		KC_PATH="extensions/positron-supervisor/resources/kallichore/kcserver.exe"
	else
		echo "⚠️ Unknown platform - skipping verification"
		echo "verified=false" >> "$GITHUB_OUTPUT"
		return
	fi

	if [ -f "$KC_PATH" ]; then
		echo "✅ Kallichore binary verified"
		echo "verified=true" >> "$GITHUB_OUTPUT"
	else
		echo "⚠️ Kallichore binary missing - skipping cache save"
		echo "verified=false" >> "$GITHUB_OUTPUT"
	fi
}

case "$BINARY_TYPE" in
	ark)
		verify_ark "$PLATFORM"
		;;
	kallichore)
		verify_kallichore "$PLATFORM"
		;;
esac
