#!/bin/bash

# Print the URL of the latest *released* (stable) Workbench package for a host OS
# and architecture.
#
# Usage: ./get-latest-wb-url.sh <os> [arch]
#   os:   ubuntu24 or rocky9
#   arch: amd64 (default) or arm64
#
# This runs inside the test container (copied to /tmp alongside the installer),
# so it is a thin wrapper over workbench-local-lib.sh rather than its own copy of
# the resolution rules -- downloads.json publishes only the x86 installer and the
# arm64 rewrite differs per OS, which is exactly the kind of detail that should
# not exist in two places.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="${SCRIPT_DIR}/workbench-local-lib.sh"
if [ ! -f "$LIB" ]; then
    echo "❌ ERROR: workbench-local-lib.sh not found next to this script ($SCRIPT_DIR)" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "$LIB"

OS="${1:-}"
wb_os_valid "$OS" || exit 1

ARCH="${2:-amd64}"
case "$ARCH" in
    amd64|x86_64) ARCH="amd64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
        echo "❌ ERROR: Unsupported architecture '$ARCH' (expected amd64 or arm64)" >&2
        exit 1
        ;;
esac

URL="$(wb_resolve_stable_url "$OS" "$ARCH")"
if [ -z "$URL" ]; then
    echo "❌ ERROR: Failed to resolve the latest released Workbench URL for ${OS}/${ARCH}" >&2
    exit 1
fi

# The arm64 URLs are derived by rewriting the published x86 one, so verify the
# artifact actually exists before handing it to the installer.
if [ "$ARCH" = "arm64" ] && ! wb_url_reachable "$URL"; then
    echo "❌ ERROR: arm64 Workbench not available at $URL" >&2
    exit 1
fi

# Return the URL (useful when called from other scripts)
echo "$URL"
