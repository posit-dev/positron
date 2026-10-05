#!/usr/bin/env bash
# Reads and drives any view by accessible role and name, the names a screen
# reader announces, not CSS classes: a view's tree, a click, a menu choice, a
# quick pick row, a field, a checkbox. Every action finds exactly one target,
# acts once, and reports what changed in the view ("diff"), so a click that did
# nothing says changed: false. A notification toast the action raised comes
# back as "notification" (its text), apart from "opened", which names the
# dialog, menu or quick pick that opened and the read command for it ("a
# dialog: read it with ui.sh read dialog"); toasts close within seconds, so
# each action watches for one for up to 1.5 s after it. A disabled or
# read-only target is refused, with nothing done. A click that times out (a
# popup on top takes it) says so in one sentence, naming what is open on top.
#
# "menu" is whatever menu is open: a menu of menu items, Positron's context
# menu (its items are buttons) or a drop-down list's popup (Save Plot's Format:
# a dialog of buttons). read menu shows it, and click menuitem NAME --in menu
# clicks any item in it, hovering first as choose does.
#
# Usage:
#   scripts/ui.sh --session NAME read Plots                       # a view by its heading
#   scripts/ui.sh --session NAME read dialog                      # also: quickpick, menu, notifications,
#                                                                 #   sidebar, secondary, panel, editor, statusbar
#   scripts/ui.sh --session NAME click button 'Show Next Plot' --in Plots
#   scripts/ui.sh --session NAME click button Continue            # "Continue (F5)": a keybinding may follow
#   scripts/ui.sh --session NAME choose button Fit 50% --in Plots # open a menu, choose an item
#   scripts/ui.sh --session NAME pick 'R 4.5.1'                   # a row of the open quick pick
#   scripts/ui.sh --session NAME fill Name red_plot --in dialog
#   scripts/ui.sh --session NAME check 'Use intrinsic size' off --in dialog
#   scripts/ui.sh --session NAME watch Console --for 8 > watch.json &  # then act, then wait
#
# Commands:
#   read [VIEW...]        the view's accessibility tree, icon glyphs removed, cut
#                         at 150 lines; several views at once come back as
#                         "trees", by name
#   watch VIEW            sample the view's text every --every ms (default
#                         100) for --for seconds (default 5) inside the page,
#                         and return its distinct "states" in order: "at" (ms
#                         from the start), "lasted" (ms), the first state's
#                         "text" and each later one's "diff" (lines added +
#                         and removed -), or "shown": false while the view is
#                         off screen; "changes" counts them. For a state that
#                         lasts a second or two (a "<session> exiting..."
#                         banner): start it in the background, act, then wait.
#                         The view must be on screen when it starts
#   click ROLE NAME       roles: button, tab, treeitem, row, checkbox, link, option...
#   fill NAME TEXT        a field by its name: textbox, spinbutton, combobox or
#                         searchbox
#   check NAME on|off     a checkbox, by the check mark drawn; reports "checked"
#                         after, and "renamed" when the click renamed it (a
#                         breakpoint row gains ", Disabled Breakpoint"): the
#                         element clicked is followed, not its old name
#   choose ROLE NAME ITEM click the trigger, then the item by name from what
#                         opened: a menu, a popup, or a list drawn inside the
#                         dialog the trigger is in (the Data Explorer filter's
#                         Select Column); a leading icon and a trailing
#                         shortcut are ignored. Reports "chose", "changed" with
#                         the view's "diff", "trigger" when the trigger's name
#                         changed (Auto -> Square), and "notification"; a
#                         disabled item is refused. When nothing opens, the
#                         error carries the overlay (or view) as "view"; an
#                         absent item, the list's "items"
#   type TEXT --in VIEW   type into the focused field, only if focus is in VIEW
#                         (after a click that opened an input); --enter to submit,
#                         refused in a quick pick (Enter runs the highlighted
#                         row, maybe another one): use pick there
#   pick TEXT             the open quick pick's row whose label is TEXT
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --in VIEW       look only in that view (as for read)
#   --nth N         which of several matches, 1 = first
#   --right         click: a right-click, for a context menu (then choose from
#                   it with: ui.sh choose ... or read menu)
#   --partial       let NAME match part of the accessible name
#   --watch VIEW    report the change in this view instead (click Step Over,
#                   watch Call Stack)
#   --wait SECS     how long to wait for the view to change after an action (default 2)
#   --for SECS      watch: how long to sample (default 5, at most 120)
#   --every MS      watch: how often (default 100, 20 to 5000)
#
# A name matches the whole accessible name, case aside, the name without a
# trailing keybinding, or the name before a comma and more (a Breakpoints row
# "dbg.R 7, Unverified Breakpoint" by "dbg.R 7", the label the view shows).
# When nothing matches, the error carries the view's tree.
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the target is not
# there or the action did not take, 2 on a usage error.

# Implemented in dp-ui.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" ui "$@"
