#!/usr/bin/env bash
# Opens a workspace file in an editor through Quick Open, and waits for its tab.
# Typing Cmd+P while focus is in a webview (the Viewer, a notebook output, an
# app) sends the keys to the page instead, and Enter on a fuzzy match opens the
# wrong file, so this moves focus to the workbench first and picks the row
# whose name is exactly the file's.
#
# Usage:
#   scripts/open-file.sh --session NAME app.R
#   scripts/open-file.sh --session NAME rapp/app.R      # when two files share the name
#
# A bare name opens the file at the workspace root when several share it.
# With a folder, only that folder's row is taken. It checks the active tab is
# that file by its path ("path"), since two open tabs can share a name.
#
# Stdout: one JSON line, e.g. {"ok":true,"opened":"app.R","folder":"rapp","path":"/x/rapp/app.R"}
# Exit code: 0 when the file's tab is active, 1 when not, 2 on a usage error.

# Implemented in dp-palette.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" open-file "$@"
