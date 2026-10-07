#!/usr/bin/env bash
# Reads and drives the Plots pane: what plot it shows, the history filmstrip,
# and the toolbar. The toolbar and menus are ui.sh calls by accessible name;
# reading the plot (a pixel check) and the filmstrip are dp-plots.ts. Each
# command reports the pane after it.
#
# Usage:
#   scripts/plots.sh --session NAME read
#   scripts/plots.sh --session NAME read --editor   # the plot open in the active editor tab
#   scripts/plots.sh --session NAME prev            # also: next
#   scripts/plots.sh --session NAME select 2
#   scripts/plots.sh --session NAME clear
#   scripts/plots.sh --session NAME remove 2
#   scripts/plots.sh --session NAME zoom 50%
#   scripts/plots.sh --session NAME open 'editor tab'
#   scripts/plots.sh --session NAME save            # opens the Save Plot dialog
#   scripts/plots.sh --session NAME save --format SVG --width 800 --height 600 --name my_plot
#
# Commands:
#   read      the plot shown: its name, its sizes ("drawn": the picture as
#             drawn on screen, in CSS pixels; "natural": the image's own
#             pixels, which are device pixels; "naturalCss": the same in CSS
#             pixels; "box": the img element in CSS pixels, which under Fit
#             fills the pane and is larger than the picture drawn in it;
#             "devicePixelRatio" relates the two units, 2 on a Retina
#             display), how many colours its pixels hold (counted up to 64;
#             1 = a blank image) and its top-left pixel; "blank": true when no plot is drawn
#             ("empty" when there is nothing to clear, a note when plots are
#             in the history but none is shown); the zoom; the toolbar
#             buttons (off = disabled); the filmstrip, with the selected one.
#             Names are the ones drawn: the header's, else the name under the
#             thumbnail ("interactive 1"); a plot drawn with no name reads as
#             its image's alt, an interactive plot's id ("Plot 8959...").
#             An interactive plot (plotly) is a webview: "webview": true and
#             its box, no pixels. --editor reads the plot in the active
#             editor tab; its "toolbar" is the editor's buttons (Save Plot
#             From Active Editor, ...), and it shows no zoom by name. With
#             no buttons found, "toolbarNote" says why: a window in compact
#             mode (a plot opened in a new window) shows none, or the editor
#             has no action bar the helper can find
#
# Sizes and zoom: the zoom levels count device pixels. 100% draws each of the
# image's pixels as one CSS pixel, so with devicePixelRatio 2 a 100% plot
# shows twice its naturalCss size; Fit draws it within the pane. The plot's
# sizing policy (Fill, Landscape, a custom size) sets the size the plot is
# rendered at, and the same policy sets the size Save Plot starts from.
#   prev      click Show Previous Plot once, as ui.sh click does (next: Show
#             Next Plot); a disabled button is refused, nothing clicked. It
#             answers with the pane after it (as read), "before" (the plot
#             shown and the filmstrip's selected thumbnail before the click),
#             and ui.sh's "changed" (the Plots view's accessibility tree
#             changed, or a toast came); compare "plot" with "before.plot"
#             to see which plot is shown. select, remove, zoom and clear
#             answer with the pane after them too
#   select N  click the Nth filmstrip thumbnail, 1 = first; the filmstrip shows
#             only with several plots and room for it: widen the pane
#             (panel.sh resize secondary 600) or set plots.historyPolicy to
#             "always"
#   remove N  hover the Nth thumbnail and click its remove button
#   zoom L    pick zoom level L (Fit, 50%, 75%, 100%, 200%) from the zoom menu
#   open W    open the plot in: editor (tab) or window (new window), or any
#             item of the toolbar's open menu by its name, and report what
#             opened: "opened" names the new editor tab, or
#             the new window by its number in shot.sh --list and its title.
#             Fails when nothing new opened within 3 s ("open" lists what
#             is): a plot already in a window of its own is not opened again
#   clear     click Clear All Plots, and report any prompt it raised
#   save      click Save Plot and report the dialog it opened ("tree"). With
#             --format F (PNG, JPEG, SVG, PDF, TIFF), --width PX, --height PX
#             and --name NAME, it fills those fields first, as ui.sh would:
#             Format is a button that opens a popup of formats (ui.sh choose
#             button Format SVG --in dialog), Width and Height are
#             spinbuttons, Name a textbox. With --width or --height, a plot
#             with a size of its own (matplotlib) has Use intrinsic size
#             ticked, which disables both: it is unticked first, and
#             "intrinsicSize" says so. A field that is disabled or missing
#             fails with ui.sh's error, the dialog left open. It never
#             clicks Save: ui.sh click button Save --in dialog does, or Cancel
#
# In the action log, each action is one line with the pane it left (the plot,
# its size and top-left pixel, the zoom); --did TEXT on read is how plots.sh
# logs that line itself. A failure is one line too.
#
# A narrow pane moves Save, Copy and the zoom into the toolbar's overflow; the
# commands that need them then say the button is missing. A plot opened in a
# new window is shot with shot.sh --window N.
#
# Names such as "matplotlib 3" do not say which plot is which: draw each test
# plot in its own colour and check the top-left pixel read reports.
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the pane, button or
# thumbnail is not there or the action did not take, 2 on a usage error.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
SESSION=""
FORMAT="" WIDTH="" HEIGHT="" NAME=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="${2-}"; shift 2 || { echo "${0##*/}: $1 needs a value" >&2; exit 2; }; [[ -n "$SESSION" ]] || { echo "${0##*/}: --session needs the session name" >&2; exit 2; } ;;
		--session=*) SESSION="${1#--session=}"; [[ -n "$SESSION" ]] || { echo "${0##*/}: --session needs the session name" >&2; exit 2; }; shift ;;
		--format) FORMAT="${2-}"; shift 2 || { echo "${0##*/}: $1 needs a value" >&2; exit 2; } ;;
		--width) WIDTH="${2-}"; shift 2 || { echo "${0##*/}: $1 needs a value" >&2; exit 2; } ;;
		--height) HEIGHT="${2-}"; shift 2 || { echo "${0##*/}: $1 needs a value" >&2; exit 2; } ;;
		--name) NAME="${2-}"; shift 2 || { echo "${0##*/}: $1 needs a value" >&2; exit 2; } ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
ARG="${ARGS[1]:-}"
S=(); [[ -n "$SESSION" ]] && S=(--session "$SESSION")
eval "$(node "$DIR/selectors.ts" names)"
# read is a reading of its own; the rest are actions that read on their way.
[[ "$CMD" == read ]] && exec node "$DIR/dp.ts" plots "${S[@]}" "${ARGS[@]}"
# The calls on the way log no readings or failures: plots.sh logs each action
# once with the pane it left (dp read --did), and its failure once, at the end.
export DRIVE_POSITRON_QUIET_READS=1
ui() { bash "$DIR/ui.sh" "${S[@]}" "$@"; }
# A ui.sh action whose line plots.sh logs itself, with the pane after it.
uiq() { DRIVE_POSITRON_QUIET_ACTIONS=1 ui "$@"; }
dp() { node "$DIR/dp.ts" plots "${S[@]}" "$@"; }
ok() { [[ "$(echo "$1" | jq -r '.ok')" == "true" ]]; }
# Runs a ui.sh action, then reports the pane, with what the action said, and
# logs the action ($1) with the pane it left.
then_read() {
	local did="$1" r p
	shift
	r=$("$@") || { echo "$r"; return 1; }
	sleep 0.3
	p=$(dp read --did "$did")
	echo "$p" | jq -c --argjson r "$r" '. + {did: ($r.did // (if $r.chose then "chose " + $r.chose else null end)), chose: $r.chose, changed: $r.changed} | with_entries(select(.value != null))'
}

# The editor tab titles, and the app's window titles: what an open made.
tabs() { bash "$DIR/panel.sh" "${S[@]}" editors | jq -c '[.groups[]? | .tabs[].title | sub(", Editor Group [0-9]+$"; "")]'; }
windows() { bash "$DIR/shot.sh" "${S[@]}" --list | jq -c '[.windows[]?.title]'; }

run() {
# A stray word is refused, not taken for something else.
case "$CMD" in prev|next|clear|save) MAX=1 ;; select|remove|zoom|open) MAX=2 ;; *) MAX=${#ARGS[@]} ;; esac
(( ${#ARGS[@]} <= MAX )) || { jq -nc --arg a "${ARGS[$MAX]}" '{ok: false, error: ("unexpected argument \"" + $a + "\"; see --help for the arguments and flags it takes")}'; exit 2; }
case "$CMD" in
	prev|next)
		B="$plots_previous"; [[ "$CMD" == next ]] && B="$plots_next"
		W=$(dp read | jq -c '{plot, selected: ([.filmstrip[]? | select(.selected) | .n][0])}')
		R=$(then_read "click $B" uiq click button "$B" --in "$views_plots") || { echo "$R"; exit 1; }
		echo "$R" | jq -c --argjson w "$W" '. + {before: $w}' ;;
	select|remove)
		[[ "$ARG" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the thumbnail number, 1 = first"}'; exit 2; }
		dp "$CMD" "$ARG" ;;
	zoom)
		[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"give the zoom: Fit, 50%, 75%, 100% or 200%"}'; exit 2; }
		CUR=$(dp read | jq -r '.zoom // empty')
		[[ -n "$CUR" ]] || { echo '{"ok":false,"error":"no zoom menu in the toolbar; the pane may be too narrow, or no plot is shown"}'; exit 1; }
		R=$(then_read "zoom $ARG" uiq choose button "$CUR" "$ARG" --in "$views_plots") || { echo "$R"; exit 1; }
		# Say ok only once the toolbar shows the zoom chosen.
		echo "$R" | jq -c --arg w "$ARG" 'if .zoom == $w then . else . + {ok: false, error: ("the zoom still shows " + (.zoom // "nothing") + " after choosing " + $w)} end'
		[[ "$(echo "$R" | jq -r '.zoom')" == "$ARG" ]] ;;
	open)
		case "$(echo "$ARG" | tr '[:upper:]' '[:lower:]')" in
			editor|'editor tab'|tab) ITEM="$plots_openInEditor" ;;
			# An interactive (webview) plot's menu has its own item for a new window.
			window|'new window') ITEM="$plots_openInWindow"; [[ "$(dp read | jq -r '.plot.webview // false')" == true ]] && ITEM="$plots_openWebviewInWindow" ;;
			'') echo '{"ok":false,"error":"give where: editor, window, or the menu item"}'; exit 2 ;;
			*) ITEM="$ARG" ;;
		esac
		# An editor tab or a window: what opened is the tab or window not there before.
		[[ "$ITEM" == *Window* ]] && SEEN=windows || SEEN=tabs
		BEFORE=$($SEEN)
		R=$(uiq choose button "$plots_openMenu" "$ITEM" --in "$views_plots") || { echo "$R"; exit 1; }
		NEW='[]'
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			# A new window is listed after the others, and another window's title can
			# change meanwhile (it names its active editor): new windows by count.
			NEW=$($SEEN | jq -c --argjson b "$BEFORE" --arg seen "$SEEN" 'if $seen == "windows" then to_entries[($b | length):] | map("\(.key + 1) \(.value)")
				else . as $a | reduce $b[] as $t ($a; (index($t)) as $i | if $i == null then . else del(.[$i]) end) end')
			[[ "$NEW" != '[]' ]] && break
			sleep 0.3
		done
		[[ "$SEEN" == tabs ]] && KIND="editor tab" || KIND="window"
		OUT=$(echo "$R" | jq -c --argjson n "$NEW" --arg k "$KIND" --argjson now "$($SEEN)" '{ok: ($n | length > 0), chose, changed}
			+ (if ($n | length) > 0 then {opened: ($k + " " + ($n | map(if $k == "window" then sub("^(?<n>[0-9]+) (?<t>.*)$"; "\(.n) \"\(.t)\"") else "\"" + . + "\"" end) | join(", ")))} else {error: ("no new " + $k + " opened within 3 s"), open: $now}
				+ (if $k == "window" then {hint: "a plot already in a window of its own is not opened in another; the windows open are in \"open\""} else {} end) end)')
		echo "$OUT"
		ok "$OUT" || exit 1
		node "$DIR/dp.ts" log plots.sh "$SESSION" "open $ITEM -> $(echo "$OUT" | jq -r .opened)" >/dev/null ;;
	clear)
		R=$(then_read "click $plots_clearAll" uiq click button "$plots_clearAll" --in "$views_plots") || { echo "$R"; exit 1; }
		P=$(bash "$DIR/notifications.sh" "${S[@]}" 2>/dev/null | jq -c '[.notifications[]? | {kind, message, buttons}]' 2>/dev/null || echo '[]')
		echo "$R" | jq -c --argjson p "${P:-[]}" '. + {prompts: $p}' ;;
	save)
		C=$(ui click button "$plots_save" --in "$views_plots") || { echo "$C"; exit 1; }
		# Each field as a person fills it; the first that fails stops here, the dialog open.
		if [[ -n "$NAME" ]]; then F=$(ui fill Name "$NAME" --in dialog) || { echo "$F"; exit 1; }; fi
		if [[ -n "$FORMAT" ]]; then F=$(ui choose button Format "$FORMAT" --in dialog) || { echo "$F"; exit 1; }; fi
		# A plot with a size of its own (matplotlib) holds Width and Height while
		# Use intrinsic size is ticked: a size given unticks it first, and says so.
		INTRINSIC=""
		if [[ -n "$WIDTH$HEIGHT" ]] && ui read dialog | jq -e --arg c "$plots_intrinsicSize" '.tree | contains("checkbox \"" + $c + "\"")' >/dev/null; then
			F=$(ui check "$plots_intrinsicSize" off --in dialog) || { echo "$F"; exit 1; }
			INTRINSIC="$(echo "$F" | jq -r 'if .already then "already unticked" else "unticked" end')"
		fi
		if [[ -n "$WIDTH" ]]; then F=$(ui fill Width "$WIDTH" --in dialog) || { echo "$F"; exit 1; }; fi
		if [[ -n "$HEIGHT" ]]; then F=$(ui fill Height "$HEIGHT" --in dialog) || { echo "$F"; exit 1; }; fi
		# The dialog as it reads now is this command's reading.
		DRIVE_POSITRON_QUIET_READS='' ui read dialog | jq -c --arg i "$INTRINSIC" --arg c "$plots_intrinsicSize" 'if $i != "" then . + {intrinsicSize: ($c + " " + $i)} else . end' ;;
	*) echo '{"ok":false,"error":"command: read, prev, next, select, remove, zoom, open, clear or save"}'; exit 2 ;;
esac
}

OUT=$(run)
RC=$?
[[ -n "$OUT" ]] && echo "$OUT"
# A failure leaves one line in the action log, with the error.
(( RC == 0 )) || node "$DIR/dp.ts" fail plots.sh "$SESSION" "$OUT" ${ARGS[@]+"${ARGS[@]}"} >/dev/null
exit $RC
