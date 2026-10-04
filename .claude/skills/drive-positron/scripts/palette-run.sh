#!/usr/bin/env bash
# Runs one Command Palette command by its exact title, and refuses to run
# anything else. Typing a title and pressing Enter runs whatever the palette
# highlights, and when the command is unavailable (its precondition is false,
# as Notebook: Run All Cells is while a cell runs) the highlight falls on a
# "similar commands" entry, such as one that deletes every cell. This script
# opens the palette, filters to the title, moves the highlight to the row whose
# label is exactly that title, and only then presses Enter.
#
# Usage:
#   scripts/palette-run.sh --session NAME 'Notebook: Run All Cells'
#   scripts/palette-run.sh --session NAME --dry-run 'View: Toggle Panel Visibility'
#
# Flags:
#   --session NAME  the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --dry-run       find and highlight the command, but do not run it
#
# The title is the label the palette shows, category included ("Interpreter:
# Start New Console Session"). When it is not listed, nothing runs: the script
# presses Escape and prints the rows that were shown, so a missing command is
# a fact to record, not a click that silently did something else.
#
# Stdout: one JSON line, e.g. {"ok":true,"chosen":"Notebook: Run All Cells","closed":true}
# Exit code: 0 when the command ran (or was found, with --dry-run), 1 when it was
# not listed, 2 on a usage error.
#
# Required tools on PATH: node, jq.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
DRY=0
TITLE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--dry-run) DRY=1; shift ;;
		-h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		-*) echo "palette-run.sh: unknown flag $1" >&2; exit 2 ;;
		*) TITLE="$1"; shift ;;
	esac
done
if [[ -z "$TITLE" ]]; then
	echo '{"ok":false,"error":"give the command title"}'
	exit 2
fi
pw_setup "$SESSION"
page() { node "$(dirname "${BASH_SOURCE[0]}")/quickpick-page.ts" "$@"; }

# Close whatever quick input is open, and take focus out of a webview, where
# the palette shortcut never reaches the workbench.
pw press Escape >/dev/null 2>&1 || true
run_js "$(page blur)" >/dev/null || true
pw press "${CMD_MOD}+Shift+p" >/dev/null 2>&1
OPEN=$(run_js "$(page open)") || { echo "$OPEN"; exit 1; }
if [[ "$(echo "$OPEN" | jq -r '.ok')" != "true" ]]; then
	echo '{"ok":false,"error":"the Command Palette did not open"}'
	exit 1
fi

FILLED=$(run_js "$(page fill ">$TITLE")") || { echo "$FILLED"; exit 1; }
CHOSEN=$(run_js "$(page choose exact "$TITLE" $([[ "$DRY" == 1 ]] && echo --dry))") || { echo "$CHOSEN"; pw press Escape >/dev/null 2>&1; exit 1; }
if [[ "$(echo "$CHOSEN" | jq -r '.ok')" != "true" ]]; then
	pw press Escape >/dev/null 2>&1
	echo "$CHOSEN" | jq -c '. + {hint: "not listed: the command may not exist under that title, or its precondition is false right now"}'
	exit 1
fi
if [[ "$DRY" == 1 ]]; then
	pw press Escape >/dev/null 2>&1
else
	log_action "palette-run.sh" "$TITLE"
fi
echo "$CHOSEN"
exit 0
