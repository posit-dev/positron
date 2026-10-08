#!/usr/bin/env bash
# Reads and drives the debugger: breakpoints, stepping, the call stack,
# watches, exception breakpoints and the Debug Console. These are recipes over
# ui.sh, which finds everything by accessible role and name, so this file holds
# no knowledge of the page's structure; the names are in selectors.ts.
#
# Usage:
#   scripts/debug.sh --session NAME state
#   scripts/debug.sh --session NAME break dbg.R 7
#   scripts/debug.sh --session NAME break dbg.R 7 --condition 'x > 3'
#   scripts/debug.sh --session NAME break dbg.R 7 --log 'x is {x}'
#   scripts/debug.sh --session NAME step over        # continue, over, into, out, restart, disconnect, pause, stop
#   scripts/debug.sh --session NAME wait paused --timeout 20
#   scripts/debug.sh --session NAME frame 2
#   scripts/debug.sh --session NAME watch 'x + 1'
#   scripts/debug.sh --session NAME filter Errors on
#   scripts/debug.sh --session NAME filter 'dbg.R 7' off
#   scripts/debug.sh --session NAME console
#   scripts/debug.sh --session NAME eval 'Sys.Date()'
#
# Commands:
#   state            the Call Stack (its header says why it paused, such as
#                    "Paused on step"; the selected row is the focused frame,
#                    with its line), Debug Variables, Watch and Breakpoints
#                    views as they read; an unverified breakpoint's name says
#                    "Unverified Breakpoint". "editor" is the active editor's
#                    file and the lines the debugger highlights in it: the top
#                    frame's, and the selected frame's (the same line when the
#                    top frame is the one selected; null only when the selected
#                    frame is not in this file). "topFrame" names the top
#                    frame, "selectedFrame" the Call Stack row selected (1 =
#                    top); at a first pause no row is selected, for a person
#                    too: "selectedFrame" is null, a note says so, and the
#                    focused frame is the top one
#   break FILE LINE  toggle a line breakpoint: open FILE, go to LINE, Debug:
#                    Toggle Breakpoint; FILE "" uses the active editor.
#                    Reports "added" or "removed" (FILE:LINE) and fails when
#                    the Breakpoints view shows neither. --condition EXPR adds
#                    a conditional breakpoint, --log MESSAGE a logpoint, through
#                    the breakpoint widget (Debug: Add Conditional Breakpoint...
#                    or Add Logpoint...) and reports the row it made, with the
#                    text the widget held: the view shows a condition only once
#                    the breakpoint is verified. On a line that already has a
#                    breakpoint, --log or --condition adds a second row beside
#                    it, and "note" names the one already there ("edited" when
#                    the view shows no new row). A breakpoint added while
#                    paused may stay unverified until the file is sourced
#                    again, for a person too. One on a line the R session has
#                    verified before (removed, then added again, the file
#                    unchanged since it was sourced) is verified at once, with
#                    no new source: its row then reads "Condition: ..." from
#                    the start, which is Ark's state, not a stale read
#   step BUTTON      click a debug toolbar button, wait up to 5 s for the
#                    Call Stack to change or go, and report the Call Stack
#                    view as it read just before ("before") and just after
#                    ("after"): its tree, header line (the pause reason, as
#                    "text: Paused on step") and frame rows; null when no Call
#                    Stack view was on screen. The view can go for a moment
#                    while the program runs between two pauses, so "after"
#                    is one reading, not where the program ended up: wait
#                    paused or wait running waits for a state. R's toolbar
#                    names its stop button "Disconnect", so in an R session
#                    use step disconnect. The header's pause reason can be
#                    hidden while still paused (the view sets it hidden, for
#                    a person too); wait paused reads the frames
#   wait [paused|running]  wait until the debugger is paused (the Call Stack
#                    shows a stack frame) or not (no frame, or no debug
#                    session: no Call Stack view), default paused,
#                    reading the view every half second up to --timeout SECS
#                    (default 30); reports "paused", the top "frame" and
#                    "waited" (s), and fails naming the state it waited for
#   frame N          select the Nth call stack row, 1 = top
#   watch EXPR       add a watch expression
#   filter ROW on|off  tick or clear a Breakpoints view checkbox: an exception
#                    breakpoint (Errors, Warnings, Interrupts) or a line one by
#                    the label the view shows ("dbg.R 7"; its full name goes
#                    on, ", Unverified Breakpoint"). Reports "checked" after,
#                    and "renamed" when the click renamed the row ("dbg.R 7,
#                    Disabled Breakpoint"); "already" when it was so
#   console          the Debug Console as it reads
#   eval EXPR        evaluate EXPR in the Debug Console and report the new lines
#
# Start a session with palette-run.sh, by the title the palette shows: the
# Python one has its category twice, 'Python Debugger: Python Debugger: Debug
# Python File'. palette-run.sh --dry-run finds the real title.
#
# Python code run in the console (console-run.sh, editor.sh run) does not stop
# at a breakpoint set in the editor, as runs have seen: the breakpoint sync is
# for notebook cells, not console input. Editor breakpoints are for a
# notebook cell's code and for a file run under the debugger (Python
# Debugger: Debug Python File); to pause console code, put breakpoint() in
# the code itself.
#
# The logs: Debugging.log (positron-runtime-debugger) can stay empty through
# a whole debug session. What the kernel did is in R Kernel.log and Python
# Kernel.log (positron-supervisor) under <runDir>/logs, which collect-logs.sh
# (.claude/skills/exploratory-test/renderer/) copies with the rest.
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the view, button or
# row is not there or nothing happened, 2 on a usage error.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
# A usage error: one JSON line on stdout, a FAILED line in the action log, exit 2.
ARGV=("$@")
usage_error() { exec node "$DIR/dp.ts" usage-error "${0##*/}" "$1" ${ARGV[@]+"${ARGV[@]}"}; }
SESSION=""
COND=""
TIMEOUT=30
LOGMSG=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session=*|--condition=*|--log=*|--timeout=*) set -- "${1%%=*}" "${1#*=}" "${@:2}" ;;  # --flag=value is --flag value, as in the dp.ts helpers
		--session) [[ -n "${2-}" ]] || usage_error "--session needs a value; leave the flag out for \$PW_SESSION"; SESSION="$2"; shift 2 ;;
		--condition) COND="${2-}"; shift 2 || usage_error "$1 needs a value" ;;
		--log) LOGMSG="${2-}"; shift 2 || usage_error "$1 needs a value" ;;
		--timeout) TIMEOUT="${2-}"; shift 2 || usage_error "$1 needs a value" ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
A1="${ARGS[1]:-}"
A2="${ARGS[2]:-}"
S=(); [[ -n "$SESSION" ]] && S=(--session "$SESSION")
eval "$(node "$DIR/selectors.ts" names)"
ui() { bash "$DIR/ui.sh" "${S[@]}" "$@"; }
# The reads on the way are this script's: state, wait and console log one line
# each, and a failure logs one line at the end; the calls' own reads and
# failures (a view not shown yet) are not logged.
export DRIVE_POSITRON_QUIET_READS=1
logread() { node "$DIR/dp.ts" log debug.sh "$SESSION" "read $*" >/dev/null; }
# A ui.sh call on the Run and Debug views, where the call stack and
# breakpoints are: when they are not on screen (no view of that name, or no
# Breakpoints view among several read), it shows them and tries once more.
dv() {
	local r rc=0
	r=$(ui "$@") || rc=$?
	if ! echo "$r" | jq -e --arg b "$views_breakpoints" '(.error // "" | test("^no view titled")) or ((.missing // []) | index($b) != null)' >/dev/null 2>&1; then
		echo "$r"
		return $rc
	fi
	bash "$DIR/palette-run.sh" "${S[@]}" "$palette_focusBreakpoints" >/dev/null 2>&1
	ui "$@"
}

run() {
# A stray word is refused, not taken for something else.
case "$CMD" in state|console) MAX=1 ;; step|wait|frame|watch|eval) MAX=2 ;; break|filter) MAX=3 ;; *) MAX=${#ARGS[@]} ;; esac
(( ${#ARGS[@]} <= MAX )) || { jq -nc --arg a "${ARGS[$MAX]}" '{ok: false, error: ("unexpected argument \"" + $a + "\"; see --help for the arguments and flags it takes")}'; exit 2; }
case "$CMD" in
	state)
		V=$(dv read "$views_callStack" "$views_debugVariables" "$views_watch" "$views_breakpoints") || { echo "$V"; exit 1; }
		E=$(bash "$DIR/editor.sh" "${S[@]}" cursor) || E='{}'
		# Monaco marks the focused frame's line only when it is not the top frame:
		# with the top frame focused, its line is both. At the first pause the
		# product selects no Call Stack row, and the focused frame is the top one.
		R=$(echo "$V" | jq -c --argjson e "$E" '
			[(.trees["Call Stack"] // "") | split("\n")[] | select(test("row \"Stack Frame "))] as $rows
			| ($rows | map(test("\\[selected\\]")) | index(true)) as $sel
			| . + {editor: {file: $e.tab, topFrameLine: $e.debug.topFrameLine,
				focusedFrameLine: ($e.debug.focusedFrameLine // (if ($sel // 0) == 0 then $e.debug.topFrameLine else null end))}}
			+ if ($rows | length) == 0 then {} else
				{topFrame: ($rows[0] | capture("Stack Frame (?<n>[^\"]*)\"").n), selectedFrame: (if $sel == null then null else $sel + 1 end)}
				+ (if $sel == null then {note: "no Call Stack row is selected (none is at a first pause, for a person too): the focused frame is the top one"} else {} end) end')
		echo "$R"
		logread "state: $(echo "$R" | jq -r '
			([(.trees["Call Stack"] // "") | split("\n")[] | select(test("row \"Stack Frame "))] | map(capture("Stack Frame (?<n>[^\"]*)\"").n)) as $f
			| ([(.trees.Breakpoints // "") | split("\n")[] | select(test("checkbox \"[^\"]+ [0-9]+[,\"]"))] | length) as $b
			| (if ($f | length) > 0 then "paused at " + $f[0] else "no stack frame" end)
			+ "; editor " + (.editor.file // "none") + " top " + (.editor.topFrameLine | tostring) + " selected " + (.editor.focusedFrameLine | tostring)
			+ "; " + ($b | tostring) + " line breakpoints"')" ;;
	break)
		[[ -n "$A2" ]] || { echo '{"ok":false,"error":"give FILE and LINE (FILE \"\" for the active editor)"}'; exit 2; }
		if [[ -n "$A1" ]]; then
			O=$(bash "$DIR/open-file.sh" "${S[@]}" "$A1") || { echo "$O"; exit 1; }
		fi
		BEFORE=$(dv read "$views_breakpoints" | jq -r '.tree // ""')
		G=$(bash "$DIR/editor.sh" "${S[@]}" goto "$A2") || { echo "$G"; exit 1; }
		if [[ -n "$COND$LOGMSG" ]]; then
			if [[ -n "$COND" ]]; then CMD_TITLE="$palette_addConditionalBreakpoint"; TEXT="$COND"; else CMD_TITLE="$palette_addLogpoint"; TEXT="$LOGMSG"; fi
			T=$(bash "$DIR/palette-run.sh" "${S[@]}" "$CMD_TITLE") || { echo "$T"; exit 1; }
			sleep 0.5
			# The widget's input takes focus (key and type refuse when it did not);
			# on a breakpoint that has one, it holds the old text: select it to replace it.
			[[ "$(uname)" == Darwin ]] && M=Meta || M=Control
			W=$(bash "$DIR/editor.sh" "${S[@]}" key "$M+a") || { echo "$W"; exit 1; }
			W=$(bash "$DIR/editor.sh" "${S[@]}" type "$TEXT") || { echo "$W" | jq -c '. + {error: ("the breakpoint widget did not take the text: " + .error)}'; exit 1; }
			TYPED=$(echo "$W" | jq -r '.input')
			K=$(bash "$DIR/editor.sh" "${S[@]}" key Enter) || { echo "$K"; exit 1; }
			[[ "$(echo "$K" | jq -r '.input // empty')" == "" ]] || { echo '{"ok":false,"error":"the breakpoint widget is still open after Enter"}'; exit 1; }
		else
			T=$(bash "$DIR/palette-run.sh" "${S[@]}" "$palette_toggleBreakpoint") || { echo "$T"; exit 1; }
		fi
		sleep 0.5
		# The row is named "dbg.R 7", then any state ("Unverified Breakpoint") or condition.
		# A breakpoint's condition shows nowhere in the view until the adapter
		# verifies it, so the widget's own input, read before Enter, is the evidence.
		R=$(dv read "$views_breakpoints" | jq -c --argjson g "$G" --arg before "$BEFORE" --arg cond "${COND:+$TYPED}" --arg log "${LOGMSG:+$TYPED}" '
			("checkbox \"" + $g.tab + " " + ($g.line | tostring) + "[,\"]") as $row
			| ([$before | split("\n")[] | select(test($row))]) as $old
			| ($old | length) as $was
			| ([.tree | split("\n")[] | select(test($row))]) as $now
			| ($g.tab + ":" + ($g.line | tostring)) as $at
			| (if $cond != "" then {condition: $cond} elif $log != "" then {log: $log} else {} end) as $typed
			# The row added is the one not there before (the last, when it reads like an old one).
			| (($now - $old) + [$now[-1]])[0] as $added
			| if ($now | length) > $was then {ok, added: $at, row: ($added | sub("^\\s*- "; ""))} + $typed
				+ (if $was > 0 then {note: ("the line already had " + ($old | map(sub("^\\s*- "; "")) | join(" and ")) + "; this added another beside it")} else {} end)
			  elif ($now | length) < $was then {ok, removed: $at}
			  elif ($now | length) == 1 and ($typed | length) > 0 then {ok, edited: $at, row: ($now[0] | sub("^\\s*- "; ""))} + $typed
			  elif ($now | length) > 1 and ($typed | length) > 0 then {ok, edited: $at, rows: ($now | map(sub("^\\s*- "; ""))), note: "the line has several breakpoints; the view does not show which one the widget changed"} + $typed
			  else {ok: false, error: ("the Breakpoints view shows no change at " + $at)} end
			+ {breakpoints: .tree}')
		echo "$R"
		[[ "$(echo "$R" | jq -r .ok)" == true ]] ;;
	step)
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the button: continue, over, into, out, restart, disconnect, pause or stop"}'; exit 2; }
		case "$(echo "$A1" | tr '[:upper:]' '[:lower:]')" in
			over) B="$debug_stepOver" ;; into) B="$debug_stepInto" ;; out) B="$debug_stepOut" ;;
			continue) B="$debug_continue" ;; restart) B="$debug_restart" ;; disconnect) B="$debug_disconnect" ;;
			pause) B="$debug_pause" ;; stop) B="$debug_stop" ;; *) B="$A1" ;;
		esac
		# Each reading is the view's tree, or {} when no Call Stack view is on screen.
		callstack() { local v; v=$("$@" read "$views_callStack") && echo "$v" && return; echo "$v" | jq -e '.error // "" | test("^no view titled")' >/dev/null && echo '{}' && return; echo "$v"; return 1; }
		BEFORE=$(callstack dv) || { echo "$BEFORE"; exit 1; }
		R=$(DRIVE_POSITRON_QUIET_ACTIONS=1 dv click button "$B" --watch "$views_callStack" --wait 5) || { echo "$R"; exit 1; }
		AFTER=$(callstack ui) || { echo "$AFTER"; exit 1; }
		R=$(jq -nc --argjson c "$R" --argjson b "$BEFORE" --argjson a "$AFTER" '{ok: true, did: $c.did, before: ($b.tree // null), after: ($a.tree // null)}')
		echo "$R"
		# The log line: the top frame row before and after, as the view showed it.
		node "$DIR/dp.ts" log debug.sh "$SESSION" "step $A1 -> Call Stack $(echo "$R" | jq -r '
			def top: if . == null then "not shown" else ([split("\n")[] | select(test("row \"Stack Frame "))][0] // "no frame" | sub("^\\s*- "; "")) end;
			"before: " + (.before | top) + "; after: " + (.after | top)')" >/dev/null ;;
	wait)
		WANT="${A1:-paused}"
		[[ "$WANT" == paused || "$WANT" == running ]] || { echo '{"ok":false,"error":"wait paused or wait running"}'; exit 2; }
		[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"--timeout takes whole seconds"}'; exit 2; }
		START=$SECONDS
		READ=dv
		while :; do
			# Paused: a stack frame row; running: none; not debugging: no Call Stack view.
			V=$($READ read "$views_callStack") || {
				echo "$V" | jq -e '.views | index("'"$views_breakpoints"'")' >/dev/null || { echo "$V"; exit 1; }
				V='{"tree":""}'
			}
			R=$(echo "$V" | jq -c --arg want "$WANT" --argjson waited $((SECONDS - START)) '
				[.tree | split("\n")[] | select(test("row \"Stack Frame "))] as $f
				| {ok: (($f | length > 0) == ($want == "paused")), paused: ($f | length > 0), waited: $waited}
				+ (if ($f | length) > 0 then {frame: ($f[0] | capture("row \"Stack Frame (?<n>[^\"]*)\"").n)} else {} end)')
			if [[ "$(echo "$R" | jq -r .ok)" == true ]]; then echo "$R"; logread "wait $WANT: $(echo "$R" | jq -r '"paused " + (.paused | tostring) + (if .frame then " at " + .frame else "" end) + " after " + (.waited | tostring) + " s"')"; exit 0; fi
			if (( SECONDS - START >= TIMEOUT )); then
				echo "$R" | jq -c --arg want "$WANT" --arg t "$TIMEOUT" '. + {error: ("not " + $want + " after " + $t + " s: the Call Stack " + (if .paused then "still shows a stack frame" else "shows no stack frame" end))}'
				exit 1
			fi
			READ=ui
			sleep 0.5
		done ;;
	frame)
		[[ "$A1" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the frame number, 1 = top"}'; exit 2; }
		dv click row '' --partial --nth "$A1" --in "$views_callStack" ;;
	watch)
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the expression"}'; exit 2; }
		C=$(dv click button "$debug_addExpression" --in "$views_watch") || { echo "$C"; exit 1; }
		ui type "$A1" --enter --in "$views_watch" ;;
	filter)
		[[ -n "$A1" && ( "$A2" == on || "$A2" == off ) ]] || { echo '{"ok":false,"error":"give the row and on or off"}'; exit 2; }
		dv check "$A1" "$A2" --in "$views_breakpoints" ;;
	console|eval)
		bash "$DIR/palette-run.sh" "${S[@]}" "$palette_focusDebugConsole" >/dev/null || { echo '{"ok":false,"error":"could not show the Debug Console"}'; exit 1; }
		sleep 0.3
		if [[ "$CMD" == console ]]; then
			R=$(ui read panel) || { echo "$R"; exit 1; }
			echo "$R"
			logread "Debug Console: ...$(echo "$R" | jq -r '.tree | split("\n") | map(select(test("^\\s*- treeitem ")) | capture("treeitem \"(?<t>[^\"]*)\"").t) | .[-3:] | join(" | ")')"
			exit 0
		fi
		[[ -n "$A1" ]] || { echo '{"ok":false,"error":"give the expression"}'; exit 2; }
		ui type "$A1" --enter --in panel ;;
	*) echo '{"ok":false,"error":"command: state, break, step, wait, frame, watch, filter, console or eval"}'; exit 2 ;;
esac
}

OUT=$(run)
RC=$?
[[ -n "$OUT" ]] && echo "$OUT"
(( RC == 0 )) || node "$DIR/dp.ts" fail debug.sh "$SESSION" "$OUT" ${ARGS[@]+"${ARGS[@]}"} >/dev/null
exit $RC
