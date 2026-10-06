#!/usr/bin/env bash
# Reads the active Data Explorer's grid: every column header, the visible rows'
# values under them, and the status bar. The grid draws only the columns in
# view, so a wide table shows a few headers at a time; this scrolls it sideways
# with the wheel events the grid handles itself, collecting as it goes, and
# scrolls back to where it started.
#
# Usage:
#   scripts/de-read.sh --session NAME
#   scripts/de-read.sh --session NAME --rows 5
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --rows N        how many of the top rows to read (default 10)
#   --title TEXT    the editor tab the grid must be in, such as "Data: df";
#                   refuses when the active tab is another, so a grid left
#                   open from an earlier step is never read by mistake
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"title":"Data: df","status":"12 rows 3 columns","columns":["id","name","score"],
#    "rows":[{"id":"1","name":"Alice","score":"9.5"}, ...]}
# "title" is the active editor tab's name. With a filter, "status" reads
# "Showing 5 rows (41.67% of 12 total) 3 columns". Every value is the text the
# cell shows; a cell the grid has not drawn yet reads as null. Column names are taken as
# unique; with two columns of one name, the second gets " (2)".
# Exit code: 0 when a grid was read, 1 when there is none.

# Implemented in dp-de.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" de-read "$@"
