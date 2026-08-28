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

# --resolve-only prints the tag and stops. The memory-metrics workflow resolves
# once in a prep job and hands the literal tag to all seven matrix jobs, so a
# prerelease published mid-run cannot split the matrix across two builds; that
# prep job must not pay to download a build it will never use.
RESOLVE_ONLY=0
if [[ "${1:-}" == "--resolve-only" ]]; then
	RESOLVE_ONLY=1
	shift
fi

VERSION_INPUT="${1:-}"
if [[ -z "$VERSION_INPUT" ]]; then
	echo "usage: download-build.sh [--resolve-only] <version|latest-prerelease|latest-release>" >&2
	exit 2
fi

REPO="posit-dev/positron-builds"

# Requires ASSET_PREFIX/ASSET_SUFFIX to be set, which is why resolve_os and
# resolve_arch run before this does.
resolve_version() {
	local input="$1"
	case "$input" in
		latest-prerelease)
			# Newest prerelease whose build asset has FINISHED UPLOADING, not
			# simply the newest that exists. A release is visible to this API
			# the moment it is created, but its ~1 GiB asset can land minutes
			# later: on 2026-08-27 release -177 published at 12:09:48 and its
			# linux x64 tarball completed at 12:15:34, and six of the seven
			# memory-matrix jobs resolved inside that window and died with "no
			# assets match the file pattern". The seventh had resolved 27
			# seconds earlier, got -166, and passed -- so the run both failed
			# and split across two builds.
			#
			# Falling back to the previous complete release is deliberate. A
			# night measured against a slightly older build is a real
			# measurement; a failed job is not one, and every row records its
			# own app_version either way.
			# $rel binds the release before descending into .assets[],
			# where "." is an asset and .tag_name would be null.
			gh api "repos/$REPO/releases?per_page=100" --jq \
				"[ .[]
				   | select(.prerelease == true)
				   | . as \$rel
				   | select([ \$rel.assets[]
				              | select(.name == (\"$ASSET_PREFIX\" + \$rel.tag_name + \"$ASSET_SUFFIX\")
				                       and .state == \"uploaded\") ] | length > 0)
				 ] | .[0].tag_name"
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

# Before resolve_version, which needs the asset name to tell a complete release
# from one still uploading. The name is platform-specific, so the check is too.
ARCH=$(resolve_arch)
OS=$(resolve_os)
if [[ "$OS" == "darwin" ]]; then
	ASSET_PREFIX="Positron-darwin-"
	ASSET_SUFFIX="-${ARCH}.zip"
else
	ASSET_PREFIX="Positron-linux-"
	ASSET_SUFFIX="-${ARCH}.tar.gz"
fi

VERSION=$(resolve_version "$VERSION_INPUT")
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
	echo "Could not resolve version from input '$VERSION_INPUT'" >&2
	echo "For latest-prerelease this also means no prerelease has a completed" >&2
	echo "${ASSET_PREFIX}<tag>${ASSET_SUFFIX} asset yet." >&2
	exit 1
fi

# Printed in the same KEY=value shape as BUILD= below, so a caller appends it
# to $GITHUB_OUTPUT the same way.
if [[ "$RESOLVE_ONLY" == "1" ]]; then
	echo "VERSION=$VERSION"
	exit 0
fi

ASSET="${ASSET_PREFIX}${VERSION}${ASSET_SUFFIX}"

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
