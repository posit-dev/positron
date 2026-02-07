#!/bin/bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#--------------------------------------------------------------------------------------------

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="$EXTENSION_DIR/pdfjs-dist"

# Check if already downloaded.
if [ -f "$TARGET_DIR/web/viewer.html" ]; then
	echo "PDF.js viewer already exists, skipping download"
	exit 0
fi

# Read version from package.json.
VERSION=$(node -p "require('$EXTENSION_DIR/package.json').dependencies['pdfjs-dist'].replace(/[^0-9.]/g, '')")

echo "Downloading PDF.js v$VERSION legacy viewer..."

# Download and extract (legacy dist for Electron compatibility).
URL="https://github.com/mozilla/pdf.js/releases/download/v$VERSION/pdfjs-$VERSION-legacy-dist.zip"
TEMP_ZIP="$EXTENSION_DIR/pdfjs-temp.zip"

curl -L -o "$TEMP_ZIP" "$URL"
unzip -q "$TEMP_ZIP" -d "$TARGET_DIR"
rm "$TEMP_ZIP"

echo "PDF.js viewer downloaded successfully to $TARGET_DIR"
