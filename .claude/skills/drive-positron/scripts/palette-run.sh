#!/usr/bin/env bash
# Runs one Command Palette command by its exact title, and refuses to run
# anything else. Typing a title and pressing Enter runs whatever row the
# palette highlights: when no row matches exactly (the command does not exist,
# or its precondition is false), that can be a different command. This script
# opens the palette, filters to the title, and clicks the row whose label is
# exactly that title.
#
# Usage:
#   scripts/palette-run.sh --session NAME 'Notebook: Run All Cells'
#   scripts/palette-run.sh --session NAME --dry-run 'View: Toggle Panel Visibility'
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --dry-run       find the command, but do not run it
#
# The title is the label the palette shows, category included ("Interpreter:
# Start New Console Session"). When it is not listed, nothing runs: the script
# presses Escape and prints the rows that were shown, so a missing command is
# a fact to record, not a click that silently did something else. A command
# is listed only while its precondition holds: a language's commands, such as
# "R: Source R File", only while a file of that language is the active editor
# (open-file.sh first). When the palette shows only its "similar commands"
# guesses, the error says so. It takes focus out of a webview first, where
# keyboard shortcuts never reach the workbench. Use --dry-run to learn a title
# that is not what you expect.
#
# A command can answer with a toast or a dialog instead of doing it at once
# (restarting a busy session asks "The runtime is busy... interrupt it and
# restart?"): it reports a toast that came within a second as
# "notification", and a modal dialog it opened as "dialogs", so the run does
# not read as nothing happening. Answer either with notifications.sh --click.
# A command that reloads or closes the window answers with a note that the
# page went away (window.sh reloads and waits for the window).
#
# Stdout: one JSON line, e.g. {"ok":true,"chosen":"Notebook: Run All Cells","closed":true}
# Exit code: 0 when the command ran (or was found, with --dry-run), 1 when it was
# not listed, 2 on a usage error.
#
# Required tools on PATH: node, jq.

# Implemented in dp-palette.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" palette-run "$@"
