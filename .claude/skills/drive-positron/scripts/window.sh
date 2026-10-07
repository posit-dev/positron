#!/usr/bin/env bash
# Reloads the window, opens a folder in it, or opens a new window, and waits
# until the workbench is back: the page reloaded, a title, the status bar
# drawn. The session keeps the page through a reload; if it loses it (three
# failed reads in a row), the command attaches it again, on --cdp-port or the
# port launch.sh recorded in instances.log for this profile, and says so
# ("reattached"). It answers with the window's title and folder after, and
# "was", the two before; and "dialogs", a modal dialog that opened within 2 s
# of the window coming back (sessions that did not reconnect: "Interpreters
# Disconnected"), which takes every key until answered.
#
# Usage:
#   scripts/window.sh --session NAME reload
#   scripts/window.sh --session NAME open-folder /private/tmp/ws2
#   scripts/window.sh --session NAME new-window
#   scripts/window.sh --session NAME select 2
#
# Commands:
#   reload            Developer: Reload Window
#   open-folder PATH  File: Open Folder..., the folder typed into its path box
#                     and OK clicked (the simple file dialog); fails when the
#                     window reloads on another folder, or a dialog (unsaved
#                     changes?) holds it, which it names
#   new-window        New Window, and wait for it; lists the windows (n,
#                     title, and "driven", the one every command acts on). The
#                     session still drives the one it drove
#   select N          drive window N from now on (playwright-cli tab-select),
#                     numbered as shot.sh --list numbers them; shot.sh
#                     --window N shoots one without it
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --timeout SECS   how long to wait for the window (default 60); not a positive
#                    number: a usage error, and nothing is done
#   --cdp-port PORT  the port to attach again on, when instances.log has none
#
# Closing a window: palette-run.sh 'Close Window' (macOS keeps the app
# running with no window; the palette has no Quit there, and Cmd+Q cannot be
# sent through CDP: stop.sh stops the app).
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"did":"open-folder","title":"ws2","folder":"/private/tmp/ws2","was":{...},"reattached":false}
# Exit code: 0 when the window is back as asked, 1 when not, 2 on a usage error.

# Implemented in dp-window.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" window "$@"
