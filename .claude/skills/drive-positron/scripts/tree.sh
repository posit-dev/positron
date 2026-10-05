#!/usr/bin/env bash
# Reads and drives a tree in a view: Positron's own trees (Data Connections,
# Variables-style grids of .positron-tree-row) and upstream ones (Explorer,
# Outline). Rows are found by label, the whole text of one piece of the row,
# such as a table's name without its "Table" prefix or type; repeated labels
# (Tables under each schema) are picked with --nth. Clicks are real mouse
# clicks, since Positron's buttons ignore a click() from page script.
#
# Usage:
#   scripts/tree.sh --session NAME --view 'Data Connections' rows
#   scripts/tree.sh --session NAME --view 'Data Connections' expand main
#   scripts/tree.sh --session NAME --view 'Data Connections' expand Tables --nth 2
#   scripts/tree.sh --session NAME --view 'Data Connections' collapse main
#   scripts/tree.sh --session NAME --view 'Data Connections' click orders
#   scripts/tree.sh --session NAME --view 'Data Connections' menu orders 'Open in Data Explorer'
#
# Commands:
#   rows                 every visible row: level (0 = top), state (expanded,
#                        collapsed, loading, leaf) and text
#   expand LABEL         expand the row, if it is collapsed, and wait for its children
#   collapse LABEL       collapse the row, if it is expanded; both report the
#                        row's state after the click and fail when it did not
#                        get there (a row in an error state can collapse instead)
#   click LABEL          click the row (selects it; some trees open it)
#   menu LABEL ITEM      right-click the row and choose ITEM, by its label without
#                        icon or shortcut, from its context menu; refuses, and
#                        closes the menu with nothing run, when ITEM is not in it
#
# A label can also be one part of a piece whose parts are joined by a middle
# dot: Shop, for a row reading Shop and SQLite with a middle dot between.
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --view TITLE     the view the tree is in, as its pane header reads; leave it
#                    out to search every view on screen
#   --nth N          which of several rows with the same label, 1 = top
#
# Trees draw only the rows in view: a row scrolled out reads as missing. Expand
# its parent or scroll first. Stdout: one JSON line. Exit code: 0 on success,
# 1 when the row or item is not there, 2 on a usage error.

# Implemented in dp-tree.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" tree "$@"
