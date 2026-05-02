#!/usr/bin/env bash
# Copyright (c) Posit Software, PBC.
#
# Resolve a Positron version (alias or literal tag), download the matching macOS
# zip from posit-dev/positron-builds, extract it, and print the resulting .app
# path on stdout in the form CODE_PATH=/path/to/Positron.app.

set -euo pipefail

VERSION_INPUT="${1:-}"
if [[ -z "$VERSION_INPUT" ]]; then
	echo "usage: download-build.sh <version|latest-prerelease|latest-release>" >&2
	exit 2
fi

REPO="posit-dev/positron-builds"

resolve_version() {
	local input="$1"
	case "$input" in
		latest-prerelease)
			gh api "repos/$REPO/releases?per_page=100" \
				--jq '[.[] | select(.prerelease == true)] | .[0].tag_name'
			;;
		latest-release)
			gh api "repos/$REPO/releases?per_page=100" \
				--jq '[.[] | select(.prerelease == false)] | .[0].tag_name'
			;;
		*)
			echo "$input"
			;;
	esac
}

resolve_arch() {
	local raw
	raw=$(uname -m)
	case "$raw" in
		arm64|aarch64) echo "arm64" ;;
		x86_64|amd64)  echo "x64"   ;;
		*) echo "Unsupported arch: $raw" >&2; exit 1 ;;
	esac
}

VERSION=$(resolve_version "$VERSION_INPUT")
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
	echo "Could not resolve version from input '$VERSION_INPUT'" >&2
	exit 1
fi
ARCH=$(resolve_arch)
ASSET="Positron-darwin-${VERSION}-${ARCH}.zip"

WORKDIR="${RUNNER_TEMP:-/tmp}/positron-build"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"

echo "Resolved version: $VERSION (arch=$ARCH)" >&2
echo "Downloading asset: $ASSET" >&2

attempt=1
max_attempts=4
while (( attempt <= max_attempts )); do
	if gh release download "$VERSION" \
			--repo "$REPO" \
			--pattern "$ASSET" \
			--dir "$WORKDIR" \
			--clobber \
			&& [[ -f "$WORKDIR/$ASSET" ]]; then
		break
	fi
	if (( attempt == max_attempts )); then
		echo "Download failed after $max_attempts attempts" >&2
		exit 1
	fi
	sleep_for=$(( attempt * 5 ))
	echo "Download attempt $attempt failed; retrying in ${sleep_for}s..." >&2
	sleep "$sleep_for"
	(( attempt++ ))
done

unzip -q "$WORKDIR/$ASSET" -d "$WORKDIR"
APP_PATH=$(find "$WORKDIR" -maxdepth 2 -name 'Positron.app' -type d | head -n1)
if [[ -z "$APP_PATH" ]]; then
	echo "Positron.app not found after extracting $ASSET" >&2
	exit 1
fi

echo "CODE_PATH=$APP_PATH"
