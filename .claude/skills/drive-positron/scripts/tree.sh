#!/usr/bin/env bash
# Reads and drives a tree in a view: Positron's own trees (Data Connections,
# Variables-style grids of .positron-tree-row) and upstream ones (Explorer,
# Outline). Rows are found by label, the whole text of one piece of the row,
# such as a table's name without its "Table ·" prefix or type; repeated labels
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
#   collapse LABEL       collapse the row, if it is expanded
#   click LABEL          click the row (selects it; some trees open it)
#   menu LABEL ITEM      right-click the row and choose ITEM from its context
#                        menu; refuses, and closes the menu, when ITEM is not in it
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --view TITLE     the view the tree is in, as its pane header reads; leave it
#                    out to search every view on screen
#   --nth N          which of several rows with the same label, 1 = top
#   --under LABEL    look only below that row, among its descendants, so a
#                    repeated label ("Tables") needs no counting across the tree
#
# Trees draw only the rows in view: a row scrolled out reads as missing. Expand
# its parent or scroll first. Stdout: one JSON line. Exit code: 0 on success,
# 1 when the row or item is not there, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
VIEW=""
NTH=0
UNDER=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--view) VIEW="$2"; shift 2 ;;
		--nth) NTH="$2"; shift 2 ;;
		--under) UNDER="$2"; shift 2 ;;
		-h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
LABEL="${ARGS[1]:-}"
ITEM="${ARGS[2]:-}"
pw_setup "$SESSION"
page() { node "$(dirname "${BASH_SOURCE[0]}")/tree-page.ts" "$@"; }
target='[data-dp-target="1"]'

case "$CMD" in
	rows)
		run_js "$(page rows "$VIEW" '' 0)"; exit $? ;;
	expand|collapse)
		[[ -n "$LABEL" ]] || { echo '{"ok":false,"error":"give the row label"}'; exit 2; }
		MARK=$(run_js "$(page mark "$VIEW" "$LABEL" "$NTH" twisty "$UNDER")") || { echo "$MARK"; exit 1; }
		[[ "$(echo "$MARK" | jq -r '.ok')" == "true" ]] || { echo "$MARK"; exit 1; }
		STATE=$(echo "$MARK" | jq -r '.state')
		if [[ "$CMD" == "expand" && "$STATE" == "expanded" ]] || [[ "$CMD" == "collapse" && "$STATE" != "expanded" ]]; then
			run_js "$(page unmark)" >/dev/null
			echo "$MARK" | jq -c '. + {changed: false}'
			exit 0
		fi
		pw click "$target" >/dev/null 2>&1
		run_js "$(page unmark)" >/dev/null
		# Wait for the row to settle: loading children can take a moment.
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			NOW=$(run_js "$(page mark "$VIEW" "$LABEL" "$NTH" row "$UNDER")") || break
			run_js "$(page unmark)" >/dev/null
			S=$(echo "$NOW" | jq -r '.state')
			[[ "$S" != "loading" && "$S" != "$STATE" ]] && break
			sleep 0.3
		done
		log_action "tree.sh" "$CMD \"$LABEL\"$([[ "$NTH" != 0 ]] && echo " (nth $NTH)") in ${VIEW:-any view}"
		# Report what the row is now: a row in an error state can collapse when
		# clicked, so "changed" says whether it reached the asked-for state.
		AFTER=$(echo "${NOW:-$MARK}" | jq -r '.state')
		WANTED=$([[ "$CMD" == expand ]] && echo expanded || echo collapsed)
		echo "${NOW:-$MARK}" | jq -c --arg b "$STATE" --arg w "$WANTED" '. + {before: $b, changed: (.state != $b), reached: (.state == $w)} | if .reached then . else . + {ok: false, error: ("the row is " + .state + ", not " + $w + ", after the click")} end'
		[[ "$AFTER" == "$WANTED" ]] || exit 1
		;;
	click)
		[[ -n "$LABEL" ]] || { echo '{"ok":false,"error":"give the row label"}'; exit 2; }
		MARK=$(run_js "$(page mark "$VIEW" "$LABEL" "$NTH" row "$UNDER")") || { echo "$MARK"; exit 1; }
		[[ "$(echo "$MARK" | jq -r '.ok')" == "true" ]] || { echo "$MARK"; exit 1; }
		pw click "$target" >/dev/null 2>&1
		run_js "$(page unmark)" >/dev/null
		log_action "tree.sh" "click \"$LABEL\" in ${VIEW:-any view}"
		echo "$MARK"
		;;
	menu)
		[[ -n "$LABEL" && -n "$ITEM" ]] || { echo '{"ok":false,"error":"give the row label and the menu item"}'; exit 2; }
		MARK=$(run_js "$(page mark "$VIEW" "$LABEL" "$NTH" row "$UNDER")") || { echo "$MARK"; exit 1; }
		[[ "$(echo "$MARK" | jq -r '.ok')" == "true" ]] || { echo "$MARK"; exit 1; }
		pw click "$target" right >/dev/null 2>&1
		run_js "$(page unmark)" >/dev/null
		CHOSE=$(run_js "$(page menu-mark "$ITEM")") || { echo "$CHOSE"; pw press Escape >/dev/null 2>&1; exit 1; }
		if [[ "$(echo "$CHOSE" | jq -r '.ok')" != "true" ]]; then
			pw press Escape >/dev/null 2>&1
			echo "$CHOSE"
			exit 1
		fi
		pw click "$target" >/dev/null 2>&1
		run_js "$(page unmark)" >/dev/null
		log_action "tree.sh" "menu \"$ITEM\" on \"$LABEL\" in ${VIEW:-any view}"
		echo "$CHOSE" | jq -c --arg r "$LABEL" '{ok: true, row: $r, item, shown}'
		;;
	*) echo '{"ok":false,"error":"command: rows, expand, collapse, click or menu"}'; exit 2 ;;
esac
