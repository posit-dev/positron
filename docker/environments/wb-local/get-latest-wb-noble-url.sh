#!/bin/bash

# Script to fetch the latest Ubuntu Noble Workbench URL from the Posit downloads endpoint
#
# Usage: ./get-latest-wb-noble-url.sh [arch]
#   arch: amd64 (default) or arm64
#
# downloads.json only publishes the amd64 noble installer. The arm64 build is
# released at the same path with "amd64" swapped for "arm64", so for arm64 we
# fetch the amd64 URL and rewrite it.

set -e

ARCH="${1:-amd64}"
case "$ARCH" in
    amd64|x86_64) ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
        echo "❌ ERROR: Unsupported architecture '$ARCH' (expected amd64 or arm64)" >&2
        exit 1
        ;;
esac

JSON_ENDPOINT="https://posit.co/wp-content/uploads/downloads.json"

# Fetch the JSON and extract the noble URL (always amd64 in the feed)
NOBLE_URL=$(curl -sL "$JSON_ENDPOINT" | jq -r '.rstudio.pro.stable.server.installer.noble.url')

if [ -z "$NOBLE_URL" ] || [ "$NOBLE_URL" = "null" ]; then
    echo "❌ ERROR: Failed to fetch the latest Noble URL from $JSON_ENDPOINT" >&2
    exit 1
fi

# Rewrite the amd64 URL to arm64 when requested
if [ "$ARCH" = "arm64" ]; then
    NOBLE_URL=$(echo "$NOBLE_URL" | sed 's/amd64/arm64/g')

    # Verify the arm64 artifact actually exists before returning it
    if ! curl -sfI "$NOBLE_URL" >/dev/null 2>&1; then
        echo "❌ ERROR: arm64 Workbench not available at $NOBLE_URL" >&2
        exit 1
    fi
fi

# Return the URL (useful when called from other scripts)
echo "$NOBLE_URL"
