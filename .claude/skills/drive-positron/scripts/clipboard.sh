#!/usr/bin/env bash
# Reads the machine's clipboard: its text, or the image on it saved to a file.
# A copy made in Positron (Copy Plot to Clipboard, Copy Cell Code, a copied
# console line) lands on the system clipboard, outside the page, so no other
# helper sees it. macOS only (osascript); elsewhere it fails and says so.
#
# Usage:
#   scripts/clipboard.sh --session NAME read
#   scripts/clipboard.sh --session NAME read --image clip-01.png
#
# Commands:
#   read              the clipboard's text ("text", null when it holds none,
#                     cut to 10000 characters with "length" and a note) and the
#                     pasteboard types it holds ("types")
#   read --image F    also save the clipboard's image (PNG, or TIFF converted)
#                     to F as a PNG and report "image": path, bytes, width and
#                     height in pixels. A bare name goes in $DRIVE_POSITRON_SHOTS
#                     when that is set, as shot.sh's does; an existing file is
#                     refused. Fails when the clipboard holds no image
#
# Flags:
#   --session NAME    names the run in the action log line; the clipboard is
#                     the machine's, not one instance's
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when there is no image,
# the file exists, or the platform is not macOS, 2 on a usage error.
#
# Required tools on PATH: osascript (macOS).

# Implemented in dp-clipboard.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" clipboard "$@"
