#!/usr/bin/env bash
# Reads and runs cells in the Positron notebook editor, for the notebook you
# name, by the notebook's accessibility tree (cells, their status lines and
# outputs, and named toolbar buttons). Each command checks that notebook is
# the active editor first and refuses
# otherwise, since a cell action on whichever notebook is in front runs code in
# the wrong file.
#
# Usage:
#   scripts/nb.sh --session NAME --notebook py.ipynb read
#   scripts/nb.sh --session NAME --notebook py.ipynb run 3
#   scripts/nb.sh --session NAME --notebook py.ipynb wait
#   scripts/nb.sh --session NAME --notebook py.ipynb type 2 'x = 1'
#   scripts/nb.sh --session NAME --notebook py.ipynb type 3 --replace 'print(x)'
#
# Commands:
#   read      every cell: number, kind, execution count, state (running,
#             pending, success, error) with its status line, its source's
#             first line, and its output's text (cut at 400 characters), kinds
#             and image count; plus the kernel badge and whether the tab is
#             modified
#   run N     run cell N (1-based) with its own Run Cell button, and report
#             the cell once its status moves
#   wait      wait until no cell is running or pending (up to --timeout, default 60 s)
#   ready     wait until the kernel badge shows the kernel idle (after a start,
#             restart or kernel change; up to --timeout). A --timeout that is
#             not a positive number of seconds is a usage error
#   kernel W  change the kernel to the picker row holding every word of W, such
#             as "R 4.5.1" or "3.14.6 uv"; refuses when no picker opens, so
#             nothing is typed into the notebook
#   restart | interrupt | clear
#             restart the kernel, interrupt it, or clear all outputs (a restart
#             of a busy kernel asks first: answer it with notifications.sh)
#   move N up|down
#             select cell N and move it
#   edit N    put the cursor in cell N's editor (a click in it; a rendered
#             Markdown cell is opened first), and check focus is there:
#             "source", the cell's lines
#   type N TEXT
#             edit N, then paste TEXT (or stdin) at the end of the cell, or
#             over all of its text with --replace, and check it is in the
#             cell after ("source"). Refuses, with nothing typed, when focus
#             is not in that cell's editor: keys in a notebook's command mode
#             edit cells (3 makes one Markdown). Run it after with run N
#
# Open the notebook first (open-file.sh). Run a whole notebook with
# palette-run.sh 'Notebook: Run All Cells', which refuses while a cell runs.
# Click a button or link in a cell's output (Retry, Open in Data Explorer)
# with ui.sh click button NAME --in editor.
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the notebook is not the
# active editor or the cell is not there, 2 on a usage error.

# Implemented in dp-nb.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" nb "$@"
