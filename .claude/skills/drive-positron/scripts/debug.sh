#!/usr/bin/env bash
# Reads and drives the debugger: its state, the toolbar, breakpoints, the call
# stack, watches, exception breakpoints and the Debug Console. Clicks are real,
# and each target is found fresh at click time: the debug toolbar redraws after
# every step, so a snapshot ref taken before a step silently clicks nothing
# after it.
#
# Usage:
#   scripts/debug.sh --session NAME state
#   scripts/debug.sh --session NAME break dbg.R 7
#   scripts/debug.sh --session NAME step over        # continue, over, into, out, restart, disconnect, pause, stop
#   scripts/debug.sh --session NAME frame 2
#   scripts/debug.sh --session NAME watch 'x + 1'
#   scripts/debug.sh --session NAME filter Errors on
#   scripts/debug.sh --session NAME console
#   scripts/debug.sh --session NAME eval 'Sys.Date()'
#
# Commands:
#   state            whether a session is debugging and why it paused (the Call
#                    Stack header, "Paused on breakpoint"), the toolbar buttons,
#                    the call stack, the frame line and breakpoint glyphs in each
#                    editor, and the Debug Variables, Watch and Breakpoints rows,
#                    with each breakpoint's icon (breakpoint, -unverified,
#                    -disabled)
#   break FILE LINE  toggle a line breakpoint: open FILE, go to LINE, Debug:
#                    Toggle Breakpoint; FILE "" uses the active editor
#   step BUTTON      click a toolbar button by label (Step Over, or just over),
#                    wait for the state to change, and report it
#   frame N          click the Nth call stack row, 1 = top
#   watch EXPR       add a watch expression and report its row
#   filter ROW on|off  tick or clear a Breakpoints view checkbox: an exception
#                    breakpoint (Errors, Warnings, Interrupts) or a line one ("dbg.R 7")
#   console          the Debug Console's lines (shows the view first)
#   eval EXPR        type EXPR into the Debug Console and print the new lines
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the button, frame or
# row is not there, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,37p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
A1="${ARGS[1]:-}"
A2="${ARGS[2]:-}"
pw_setup "$SESSION"
DIR="$(dirname "${BASH_SOURCE[0]}")"
page() { node "$DIR/debug-page.ts" "$@"; }
SFLAG=(); [[ -n "$SESSION" ]] && SFLAG=(--session "$SESSION")
ok() { [[ "$(echo "$1" | jq -r '.ok')" == "true" ]]; }
click_marked() {
	pw click '[data-dp-target="1"]' >/dev/null 2>&1
	local rc=$?
	run_js "$(page unmark)" >/dev/null
	return $rc
}
state() { run_js "$(page state)"; }
# Shows the Run and Debug views, where the call stack and breakpoints are.
show_views() {
	local has
	has=$(run_js "(() => JSON.stringify({ ok: !!document.querySelector('.debug-breakpoints') && document.querySelector('.debug-breakpoints').offsetParent !== null }))()" | jq -r '.ok')
	[[ "$has" == "true" ]] || "$DIR/palette-run.sh" "${SFLAG[@]}" 'Run and Debug: Focus on Breakpoints View' >/dev/null 2>&1
}

case "$CMD" in
	state) state ;;
	break)
		[[ -n "$A2" ]] || { echo '{"ok":false,"error":"give FILE and LINE (FILE \"\" for the active editor)"}'; exit 2; }
		if [[ -n "$A1" ]]; then
			O=$("$DIR/open-file.sh" "${SFLAG[@]}" "$A1") || { echo "$O"; exit 1; }
		fi
		G=$("$DIR/editor.sh" "${SFLAG[@]}" goto "$A2") || { echo "$G"; exit 1; }
		T=$("$DIR/palette-run.sh" "${SFLAG[@]}" 'Debug: Toggle Breakpoint') || { echo "$T"; exit 1; }
		sleep 0.7
		show_views
		S=$(state)
		TAB=$(echo "$G" | jq -r '.tab')
		echo "$S" | jq -c --arg tab "$TAB" --argjson line "$A2" '{ok: true, file: $tab, line: $line,
			breakpoint: ([.breakpoints[] | select(.exception | not) | select(.text == ($tab + " " + ($line | tostring)))][0] // null),
			breakpoints: [.breakpoints[] | select(.exception | not) | .text]}
			| if .breakpoint == null then . + {note: "no breakpoint at that line now: the toggle removed one, or the view lists it under another name"} else . end' ;;
	step)
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the button: continue, over, into, out, restart, disconnect, pause or stop"}'; exit 2; }
		case "$(echo "$A1" | tr '[:upper:]' '[:lower:]')" in
			over) WANT="Step Over" ;; into) WANT="Step Into" ;; out) WANT="Step Out" ;;
			*) WANT="$A1" ;;
		esac
		BEFORE=$(state)
		M=$(run_js "$(page mark-button "$WANT")") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		click_marked || { echo "$M" | jq -c '{ok: false, error: ("the click on " + .button + " did not land")}'; exit 1; }
		log_action "debug.sh" "click debug toolbar $(echo "$M" | jq -r '.button')"
		KEY_BEFORE=$(echo "$BEFORE" | jq -c '[.callStack, .editors[].frameLines, .debugging]')
		AFTER="$BEFORE"
		for _ in $(seq 1 20); do
			sleep 0.25
			AFTER=$(state)
			[[ "$(echo "$AFTER" | jq -c '[.callStack, .editors[].frameLines, .debugging]')" != "$KEY_BEFORE" ]] && break
		done
		CHANGED=true
		[[ "$(echo "$AFTER" | jq -c '[.callStack, .editors[].frameLines, .debugging]')" == "$KEY_BEFORE" ]] && CHANGED=false
		echo "$AFTER" | jq -c --arg b "$(echo "$M" | jq -r '.button')" --argjson c "$CHANGED" '{ok: true, clicked: $b, changed: $c} + (if $c then {} else {note: "nothing changed in 5 s: the step may still be running, or it ended where it began"} end) + del(.ok)' ;;
	frame)
		[[ "$A1" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the frame number, 1 = top"}'; exit 2; }
		show_views
		M=$(run_js "$(page mark-frame "$A1")") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		click_marked
		log_action "debug.sh" "select call stack frame $A1 ($(echo "$M" | jq -r '.frame.name'))"
		sleep 0.5
		state | jq -c '{ok: true, callStack, editors}' ;;
	watch)
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the expression"}'; exit 2; }
		show_views
		M=$(run_js "$(page mark-header-action Watch 'Add Expression')") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		pw hover '[data-dp-hover="1"]' >/dev/null 2>&1
		click_marked
		F=$(run_js "$(page focused)")
		[[ "$(echo "$F" | jq -r '.inWatch')" == "true" ]] || { echo '{"ok":false,"error":"no watch input opened"}'; exit 1; }
		pw type "$A1" >/dev/null 2>&1
		pw press Enter >/dev/null 2>&1
		log_action "debug.sh" "add watch $A1"
		sleep 0.7
		state | jq -c '{ok: true, watch}' ;;
	filter)
		[[ -n "$A1" && ( "$A2" == on || "$A2" == off ) ]] || { echo '{"ok":false,"error":"give the row and on or off"}'; exit 2; }
		show_views
		M=$(run_js "$(page mark-filter "$A1")") || { echo "$M"; exit 1; }
		ok "$M" || { echo "$M"; exit 1; }
		IS=$(echo "$M" | jq -r '.enabled')
		if [[ ( "$A2" == on && "$IS" != true ) || ( "$A2" == off && "$IS" == true ) ]]; then
			click_marked
			log_action "debug.sh" "turn $A2 breakpoint row $(echo "$M" | jq -r '.row')"
			sleep 0.4
		else
			run_js "$(page unmark)" >/dev/null
		fi
		state | jq -c --arg r "$(echo "$M" | jq -r '.row')" '{ok: true, row: $r, breakpoints}' ;;
	console|eval)
		C=$(run_js "$(page console)")
		if ! ok "$C"; then
			"$DIR/palette-run.sh" "${SFLAG[@]}" 'Debug Console: Focus on Debug Console View' >/dev/null 2>&1
			sleep 0.5
			C=$(run_js "$(page console)")
			ok "$C" || { echo "$C"; exit 1; }
		fi
		if [[ "$CMD" == console ]]; then echo "$C"; exit 0; fi
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the expression"}'; exit 2; }
		N=$(echo "$C" | jq '.lines | length')
		M=$(run_js "$(page mark-repl-input)") || { echo "$M"; exit 1; }
		click_marked
		pw type "$A1" >/dev/null 2>&1
		pw press Enter >/dev/null 2>&1
		log_action "debug.sh" "Debug Console: $A1"
		for _ in $(seq 1 12); do
			sleep 0.25
			C=$(run_js "$(page console)")
			[[ "$(echo "$C" | jq '.lines | length')" -gt $((N + 1)) ]] && break
		done
		echo "$C" | jq -c --argjson n "$N" '{ok: true, lines: .lines[$n:]}' ;;
	*) echo '{"ok":false,"error":"command: state, break, step, frame, watch, filter, console or eval"}'; exit 2 ;;
esac
