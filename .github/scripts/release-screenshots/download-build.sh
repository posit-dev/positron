#!/usr/bin/env bash
# Resolve a Positron version (alias or literal tag), download the matching build
# from posit-dev/positron-builds, extract it, and print the resulting build path
# on stdout in the form BUILD=/path/to/build (consumed by the e2e test infra via
# process.env.BUILD).
#
# macOS downloads the darwin zip and prints the .app bundle path. Linux
# downloads the tarball and prints the directory holding the `positron`
# executable, which is what getBuildElectronPath expects on that platform.

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
			# Stable releases are flagged on posit-dev/positron; $REPO (positron-builds)
			# marks every tag as prerelease=true, so filtering there returns nothing.
			gh api "repos/posit-dev/positron/releases/latest" --jq '.tag_name'
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

resolve_os() {
	case "$(uname -s)" in
		Darwin) echo "darwin" ;;
		Linux)  echo "linux"  ;;
		*) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
	esac
}

VERSION=$(resolve_version "$VERSION_INPUT")
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
	echo "Could not resolve version from input '$VERSION_INPUT'" >&2
	exit 1
fi
ARCH=$(resolve_arch)
OS=$(resolve_os)

if [[ "$OS" == "darwin" ]]; then
	ASSET="Positron-darwin-${VERSION}-${ARCH}.zip"
else
	ASSET="Positron-linux-${VERSION}-${ARCH}.tar.gz"
fi

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

if [[ "$OS" == "darwin" ]]; then
	unzip -q "$WORKDIR/$ASSET" -d "$WORKDIR"
	BUILD_PATH=$(find "$WORKDIR" -maxdepth 2 -name 'Positron.app' -type d | head -n1)
	if [[ -z "$BUILD_PATH" ]]; then
		echo "Positron.app not found after extracting $ASSET" >&2
		exit 1
	fi
else
	# The Linux tarball extracts flat (./positron, ./bin/, ./resources/) rather
	# than into a single top-level directory, so give it a directory of its own
	# instead of unpacking alongside the downloaded archive.
	BUILD_PATH="$WORKDIR/positron-linux"
	mkdir -p "$BUILD_PATH"
	tar -xzf "$WORKDIR/$ASSET" -C "$BUILD_PATH"
	if [[ ! -x "$BUILD_PATH/positron" ]]; then
		echo "positron executable not found at $BUILD_PATH/positron after extracting $ASSET" >&2
		exit 1
	fi
fi

echo "BUILD=$BUILD_PATH"
# The resolved version, distinct from $VERSION_INPUT when that was an alias
# (latest-prerelease, latest-release). Callers that need a second, independent
# download of the same release (e.g. the memory metrics server lane) must reuse
# this rather than re-resolving the alias, which can drift to a different
# release between the two calls.
echo "VERSION=$VERSION"
