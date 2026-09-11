#!/usr/bin/env bash

# create-package.sh
#
# Archive build results for the current architecture

set -e

ROOT="$(dirname "$(dirname "$(readlink -f "$0")")")"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/package.json" ]; then
	echo "Error: could not locate the repo root (got '$ROOT')"
	exit 1
fi

function help() {
	cat <<EOF
usage: create-package.sh

Takes build output for current architecture and archives it next to the repo as
../package/pwb-code-server-<version>-<arch>.tar.gz. Writes the archive filename
to the pwb-package file at the repo root so publishing steps can find it.

Requires the pwb-version file created by set-version.sh.

EOF
exit 1
}

# ensure we got a version string
if [ ! -f "$ROOT/pwb-version" ]; then
	echo "Expected pwb-version file to have been created by set-version.sh script"
	help
fi

VERSION="$(cat "$ROOT/pwb-version")"
if [ -z "$VERSION" ]; then
	echo "Error: pwb-version file is empty"
	help
fi

# determine architecture
if [[ $(uname -m) == "aarch64" || $(uname -m) == "arm64" ]]; then
    SOURCE_ARCH=arm64
    DEST_ARCH=arm64
else
    SOURCE_ARCH=x64
    DEST_ARCH=x86_64
fi

# check for build output
BUILDFOLDER=vscode-reh-web-pwb-linux-${SOURCE_ARCH}
if [ ! -d "$ROOT/../${BUILDFOLDER}" ]; then
    echo "Error: build output not found at ${BUILDFOLDER}"
    exit 1
fi

# create archive
ARCHIVE="pwb-code-server-${VERSION}-${DEST_ARCH}.tar.gz"
echo "Creating archive: $ARCHIVE"
PACKAGE_DIR="$ROOT/../package"
mkdir -p "$PACKAGE_DIR"

# the staging folder is build output; clear it so repeat runs in a reused
# workspace don't nest the new build inside the previous one
rm -rf "$PACKAGE_DIR/pwb-code-server"
mv "$ROOT/../${BUILDFOLDER}" "$PACKAGE_DIR/pwb-code-server"
cp -Rp "$ROOT/bin" "$PACKAGE_DIR/pwb-code-server"
cp -p "$ROOT/pwb-version" "$PACKAGE_DIR/pwb-code-server"

tar -czf "$PACKAGE_DIR/${ARCHIVE}" -C "$PACKAGE_DIR" pwb-code-server

# record the archive name for the upload/publish step
echo "${ARCHIVE}" > "$ROOT/pwb-package"
echo "Success: Created ${ARCHIVE}"
