#!/bin/bash
#---------------------------------------------------------------------------------------------
#  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
#  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#--------------------------------------------------------------------------------------------

#--------------------------------------------------------------------------------------------
#
# This script downloads the PDF.js viewer from GitHub releases.
#
# IMPORTANT: The pdfjs-dist npm package (in node_modules) only contains library files
# (pdf.mjs, pdf_viewer.mjs, etc.) - it does NOT include the full viewer application
# (viewer.html, viewer.css, locale files, etc.). The complete viewer must be downloaded
# separately from GitHub releases, which is what this script does. The viewer is downloaded
# as a zip file, extracted, and the relevant files are copied to the extension's pdfjs-dist
# directory. This directory is .gitignored so that we don't accidentally commit the large
# viewer files to the repository.
#
#--------------------------------------------------------------------------------------------

# Exit immediately if any command returns a non-zero (error) exit code.
set -e

# Determine paths.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="$EXTENSION_DIR/pdfjs-dist"

# Check if the PDF.js viewer is already downloaded.
if [ -f "$TARGET_DIR/web/viewer.html" ]; then
	echo "PDF.js viewer has already been downloaded. Skipping download."
	exit 0
fi

# Read version from package.json so we stay in sync with the installed version of pdfjs-dist.
VERSION=$(node -p "require('$EXTENSION_DIR/package.json').dependencies['pdfjs-dist'].replace(/[^0-9.]/g, '')")

# Log the version being downloaded for clarity.
echo "Downloading PDF.js v$VERSION legacy viewer..."

# Download and extract (legacy dist for Electron compatibility).
URL="https://github.com/mozilla/pdf.js/releases/download/v$VERSION/pdfjs-$VERSION-legacy-dist.zip"
TEMP_ZIP="$EXTENSION_DIR/pdfjs-temp.zip"

curl -L -o "$TEMP_ZIP" "$URL"
unzip -q "$TEMP_ZIP" -d "$TARGET_DIR"
rm "$TEMP_ZIP"

# Log success message.
echo "PDF.js viewer downloaded successfully to $TARGET_DIR"
