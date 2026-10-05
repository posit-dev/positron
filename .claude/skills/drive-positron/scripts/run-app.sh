#!/usr/bin/env bash
# Clicks the active editor's Run App button, whatever the extension calls it
# ("Run Shiny App", "Run Flask App in Terminal", "Run Streamlit App in
# Terminal"), and fails loudly when the editor has none.
#
# Usage:
#   scripts/run-app.sh --session NAME
#   scripts/run-app.sh --session NAME --label 'Run Shiny App'
#   scripts/run-app.sh --session NAME --list
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --label TEXT    click the button with exactly this label; needed only when
#                   the editor has several run buttons
#   --list          print the editor's run buttons and click nothing
#
# Open the app file first (open-file.sh). The app's own progress, such as
# "Found app URL", is in the App Launcher output channel; a prompt such as
# "The runtime is busy..." arrives as a toast: check notifications.sh after.
# The click is a real mouse click, since the button ignores one from page
# script.
#
# Port 5000 on a Mac belongs to the AirPlay Receiver (ControlCenter): an app
# on it gets AirPlay's 403, and a check that the port closed always fails.
# "port" warns when a Flask app will land there; run it on another port.
#
# Stdout: one JSON line, e.g. {"ok":true,"clicked":"Run Shiny App","started":true,"buttons":["Run Shiny App"]}
# "started" is false, with a "hint", when no toast, terminal, console or busy
# session followed within 5 s.
# Exit code: 0 when a button was clicked, 1 when none matched, 2 on a usage error.

# Implemented in dp-run-app.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" run-app "$@"
