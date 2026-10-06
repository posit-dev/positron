#!/usr/bin/env bash
# Sets one setting in the instance's own settings.json, merged into the file
# (its other settings and comments stay), instead of copying a settings.json
# over it. The page says where the files are: --workspace (the default) is the
# open folder's .vscode/settings.json, made when missing; --user is the run's
# disposable profile's settings.json.
#
# Usage:
#   scripts/settings.sh --session NAME set quarto.inlineOutput.enabled true
#   scripts/settings.sh --session NAME set editor.fontSize 16 --user
#   scripts/settings.sh --session NAME set python.defaultInterpreterPath /x/bin/python
#
# VALUE is read as JSON when it parses (true, 3, "text", [1, 2],
# {"a": 1}), and as a string otherwise. It reads the file back after writing
# and fails when the key does not hold the value. The app takes the change
# through its file watcher, a moment later, with no reload; this does not
# check that it did: read the setting's effect, or the Settings editor.
# Refuses a window with a .code-workspace open, whose settings live in that file.
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"key":"editor.fontSize","value":16,"scope":"user","file":"/tmp/.../User/settings.json"}
# Exit code: 0 when written, 1 when the file cannot be found, parsed or
# written, 2 on a usage error.

# Implemented in dp-settings.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" settings "$@"
