#!/usr/bin/env bash
# Moves the cursor in the active text editor and reads where it is. Breakpoints,
# Run Cell and most editor commands act on the cursor's line, so a step that
# needs line 9 goes there first.
#
# Usage:
#   scripts/editor.sh --session NAME goto 9
#   scripts/editor.sh --session NAME goto 9:5
#   scripts/editor.sh --session NAME cursor
#
# Commands:
#   goto LINE[:COL]  put the cursor on that line (and column), through Go to
#                    Line in the quick open, and report where it landed
#   cursor           the active editor's tab and the cursor's line and column
#
# Stdout: one JSON line, e.g. {"ok":true,"tab":"dbg.R","line":9,"column":1}
# Exit code: 0 when the cursor is where it was asked to be, 1 when it is not or
# there is no text editor, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
WHERE="${ARGS[1]:-}"
pw_setup "$SESSION"
page() { node "$(dirname "${BASH_SOURCE[0]}")/quickpick-page.ts" "$@"; }

cursor() {
	run_js "(() => {
		const st = [...document.querySelectorAll('.statusbar-item')].map(s => s.innerText).find(t => /^Ln \\d+, Col \\d+/.test(t));
		const tab = document.querySelector('.editor-group-container.active .tab.active .label-name')?.textContent.trim() || null;
		if (!st) { return JSON.stringify({ ok: false, error: 'no cursor position in the status bar: the active editor is not a text editor', tab }); }
		const m = st.match(/^Ln (\\d+), Col (\\d+)/);
		return JSON.stringify({ ok: true, tab, line: Number(m[1]), column: Number(m[2]) });
	})()"
}

case "$CMD" in
	cursor) R=$(cursor); echo "$R"; [[ "$(echo "$R" | jq -r '.ok')" == "true" ]] || exit 1 ;;
	goto)
		[[ "$WHERE" =~ ^[0-9]+(:[0-9]+)?$ ]] || { echo '{"ok":false,"error":"give LINE or LINE:COL"}'; exit 2; }
		BEFORE=$(cursor)
		[[ "$(echo "$BEFORE" | jq -r '.ok')" == "true" ]] || { echo "$BEFORE"; exit 1; }
		OPEN_NOW=$(run_js "$(page open)" 2>/dev/null | jq -r '.ok' 2>/dev/null)
		[[ "$OPEN_NOW" == "true" ]] && pw press Escape >/dev/null 2>&1
		pw press "${CMD_MOD}+Shift+p" >/dev/null 2>&1
		OPEN=$(run_js "$(page open)") || { echo "$OPEN"; exit 1; }
		[[ "$(echo "$OPEN" | jq -r '.ok')" == "true" ]] || { echo '{"ok":false,"error":"the quick open did not open"}'; exit 1; }
		run_js "$(page fill ":$WHERE")" >/dev/null || { pw press Escape >/dev/null 2>&1; echo '{"ok":false,"error":"could not type the line"}'; exit 1; }
		pw press Enter >/dev/null 2>&1
		log_action "editor.sh" "go to line $WHERE in $(echo "$BEFORE" | jq -r '.tab')"
		R=$(cursor)
		LINE="${WHERE%%:*}"
		COL=""; [[ "$WHERE" == *:* ]] && COL="${WHERE#*:}"
		if [[ "$(echo "$R" | jq -r '.line')" != "$LINE" || ( -n "$COL" && "$(echo "$R" | jq -r '.column')" != "$COL" ) ]]; then
			echo "$R" | jq -c '. + {ok: false, error: "the cursor is not where asked; the file may be shorter"}'
			exit 1
		fi
		echo "$R" ;;
	*) echo '{"ok":false,"error":"command: goto or cursor"}'; exit 2 ;;
esac
