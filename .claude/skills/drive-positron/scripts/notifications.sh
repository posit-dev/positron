#!/usr/bin/env bash
# Lists the notifications and dialogs on screen, with their buttons, and clicks
# one. A prompt often arrives as a toast ("The runtime is busy... interrupt it and
# restart?") that a screenshot misses and a click elsewhere hides, so after an
# action that might ask something, run this before deciding it did nothing.
#
# Usage:
#   scripts/notifications.sh --session NAME
#   scripts/notifications.sh --session NAME --click 'Restart' --match 'runtime is busy'
#   scripts/notifications.sh --session NAME --clear
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --click TEXT    click the button with this exact label
#   --match TEXT    with --click, only on a notification whose message holds TEXT;
#                   needed when several notifications have that button
#   --clear         close every notification toast
#
# Reads toasts, the notification center when it is open, and any modal dialog
# ("Do you want to save the changes...?"), which comes back as kind "dialog".
# A dialog shown again while the first is open (a runtime's "is not
# responding" prompt, a Positron modal: Wait or Force Quit) stacks a copy over
# it: both are listed, --click answers the one on top, and "dialogs" lists
# what is still open after. Hidden toasts stay in the center, so open it with
# palette-run.sh 'Notifications: Show Notifications' to read older ones.
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"notifications":[{"severity":"info","message":"...","source":"...","buttons":["Yes","No"]}]}
# Exit code: 0 on success, 1 when --click found no such button, 2 on a usage error
# (an unknown flag, --click or --match with no value, --match without --click,
# --click with --clear).
#
# Required tools on PATH: jq.

# Implemented in dp-notifications.ts.
exec node "$(dirname "${BASH_SOURCE[0]}")/dp.ts" notifications "$@"
