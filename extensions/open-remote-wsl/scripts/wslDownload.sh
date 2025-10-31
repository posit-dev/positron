#!/bin/sh

# ---------------------------------------------------------------------------------------------
#   Copyright (C) 2025 Posit Software, PBC. All rights reserved.
#   Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
# --------------------------------------------------------------------------------------------

# Adapted from Microsoft VS Code Remote - WSL

COMMIT=$1
QUALITY=$2
POSITRON_REMOTE_BIN=$3
VERSION=$4

[ "$VSCODE_WSL_DEBUG_INFO" = true ] && set -x

download() {
	if [ ! "$(command -v wget)" ]; then
		echo "ERROR: Failed to download the Positron server. 'wget' not installed." 1>&2
		exit 14
	fi

	local_name=$1

	case $(uname -m) in
		x86_64 | amd64)
			ARCH_SHORT="x64"
			ARCH_LONG="x86_64"
			;;
		armv7l | armv8l)
			ARCH_SHORT="armhf"
			ARCH_LONG="armhf"
			;;
		arm64 | aarch64)
			ARCH_SHORT="arm64"
			ARCH_LONG="arm64"
			;;
		*)
			echo "Unknown architecture: $(uname -m), defaulting to x64"
			ARCH_SHORT="x64"
			ARCH_LONG="x86_64"
			;;
	esac

	OS_NAME="linux"
	# Build download URL using Positron's pattern
	local_url="https://cdn.posit.co/positron/dailies/reh/${ARCH_LONG}/positron-reh-${OS_NAME}-${ARCH_SHORT}-${VERSION}.tar.gz"

	echo "Downloading Positron server for $OS_NAME-$ARCH_SHORT ($VERSION)..."
	wget -O "$local_name" "$local_url"

	if [ ! -s "$local_name" ]; then
		echo "ERROR: Failed to download Positron server from $local_url"
		exit 13
	fi
}

if [ ! -d "$POSITRON_REMOTE_BIN/$COMMIT" ]; then
	echo "Setting up Positron server in $POSITRON_REMOTE_BIN"

	mkdir -p "$POSITRON_REMOTE_BIN"

	# Prepare .tar.gz file
	SERVER_TAR_FILE="$POSITRON_REMOTE_BIN/$COMMIT-$(date +%s).tar.gz"
	download "$SERVER_TAR_FILE"

	# Extract it
	TMP_EXTRACT_FOLDER="$POSITRON_REMOTE_BIN/$COMMIT-$(date +%s)-tmp"
	mkdir "$TMP_EXTRACT_FOLDER"

	echo "Extracting Positron server archive..."
	tar -xf "$SERVER_TAR_FILE" -C "$TMP_EXTRACT_FOLDER" --strip-components 1

	if [ $? -ne 0 ]; then
		echo "ERROR: Failed to extract Positron server archive"
		rm -f "$SERVER_TAR_FILE"
		exit 15
	fi

	rm -f "$SERVER_TAR_FILE"

	# Move to final location
	mv "$TMP_EXTRACT_FOLDER" "$POSITRON_REMOTE_BIN/$COMMIT"
fi
