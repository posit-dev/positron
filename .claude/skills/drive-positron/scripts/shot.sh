#!/usr/bin/env bash
# Takes a screenshot and logs it. A raw `playwright-cli screenshot` writes the
# file but no line in the run's action log, and a cited shot the log never took
# fails lint, so take every shot through this.
#
# Usage:
#   scripts/shot.sh --session NAME S03-01.png
#   scripts/shot.sh --session NAME S03-02.png '.positron-variables'
#   scripts/shot.sh --session NAME --list
#   scripts/shot.sh --session NAME --window 2 S03-03.png
#   scripts/shot.sh --session NAME --view 'active console' S03-04.png
#   scripts/shot.sh --session NAME --view Plots S03-05.png
#
#   NAME.png    the file; a bare name goes in $DRIVE_POSITRON_SHOTS (the run's
#               shots/ folder) when that is set, else the current directory.
#               A name already in $DRIVE_POSITRON_SHOTS is refused, with the
#               next free name, since a run's shot is never overwritten; a name
#               with characters other than A-Z a-z 0-9 . _ - is refused (lint
#               cannot read it), with one that works
#   SELECTOR    optional: shoot only that element; it must match exactly
#               one visible element, or be a snapshot ref (e153)
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --list          print the app's windows as JSON: n, title, and which one is
#                   attached (the one every other command drives)
#   --window N      shoot window N of that list instead, such as a plot opened
#                   in a new window
#   --view VIEW     shoot one view, named as ui.sh read names it (Plots,
#                   Variables, dialog, panel), or "active console": the console
#                   in front alone, since every session's console is laid out
#                   under it and a selector for one matches them all
#
# Stdout: the path written (--list: one JSON line). Exit code: 0 when the file was written, 1 when not.

# Implemented in dp-shot.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" shot "$@"
