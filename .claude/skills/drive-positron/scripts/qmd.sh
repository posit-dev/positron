#!/usr/bin/env bash
# Reads and drives Quarto inline output in the active .qmd editor: its cells,
# each cell's toolbar and run state, and the output drawn under each cell.
# Clicks are real. Keys are not pressed for you: in a .qmd with a cell running,
# Escape is bound to Quarto: Interrupt Kernel, so this never presses it.
#
# Inline output is opt-in: set "quarto.inlineOutput.enabled": true first.
#
# Usage:
#   scripts/qmd.sh --session NAME cells
#   scripts/qmd.sh --session NAME read
#   scripts/qmd.sh --session NAME run 2
#   scripts/qmd.sh --session NAME wait 2 60
#   scripts/qmd.sh --session NAME stop 2
#   scripts/qmd.sh --session NAME button 2 'Run this cell and all cells below'
#
# Commands:
#   cells           the code cells in the saved file: number, language, the
#                   line of the opening fence, and its first code line; "dirty"
#                   when the editor has unsaved edits, so lines may differ
#   read            what is on screen: the visible line range, each visible
#                   cell's fence line, run state (idle, queued, running) and run
#                   button, and each output under a line: its status (running,
#                   pending, success, error), footer text, output kinds (stdout,
#                   stderr, error, image, html, data-explorer) and text
#   run N           go to cell N, click its Run button, and report the cell
#   wait N [SECS]   wait until cell N is no longer queued or running (default
#                   60 s): idle, completed or error; and report it
#   stop N          click cell N's Stop button while it runs (Cancel when queued)
#   button N LABEL  click another of cell N's toolbar buttons by its label:
#                   "Run all cells above this cell", "Run this cell and all
#                   cells below", "More cell actions"
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when there is no .qmd
# editor, cell or button, or a wait timed out, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		-h|--help) sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
CMD="${ARGS[0]:-}"
N="${ARGS[1]:-}"
A2="${ARGS[2]:-}"
pw_setup "$SESSION"
DIR="$(dirname "${BASH_SOURCE[0]}")"
SFLAG=(); [[ -n "$SESSION" ]] && SFLAG=(--session "$SESSION")
ok() { [[ "$(echo "$1" | jq -r '.ok')" == "true" ]]; }

COMMON="
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
	const group = document.querySelector('.editor-group-container.active');
	const tab = group?.querySelector('.tab.active');
	const ed = [...(group?.querySelectorAll('.monaco-editor') || [])].find(e => e.offsetParent !== null);
	const nums = () => [...ed.querySelectorAll('.margin-view-overlays .line-numbers')].map(n => ({ n: Number(clean(n)), top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom }));
	// The line an element sits on, or for an output zone, the last line above it.
	// The toolbar floats a few pixels above its line, so take the nearest line within half a line.
	const lineAt = el => { const t = el.getBoundingClientRect().top; let best = null; for (const l of nums()) { const d = Math.abs(l.top - t); if (d < (l.bottom - l.top) / 2 + 1 && (!best || d < best.d)) { best = { n: l.n, d }; } } return best ? best.n : null; };
	const lineAbove = el => { const t = el.getBoundingClientRect().top; let best = null; for (const l of nums()) { if (l.bottom <= t + 1 && (!best || l.top > best.top)) { best = l; } } return best ? best.n : null; };
	const toolbars = () => [...ed.querySelectorAll('.quarto-cell-toolbar')].filter(t => t.style.display !== 'none' && t.style.top !== '')
		.map(t => ({ el: t, line: lineAt(t), state: t.getAttribute('data-execution-state'), run: t.querySelector('.quarto-toolbar-run')?.getAttribute('aria-label') }));
"
FILE_JS="(() => {$COMMON
	if (!ed || !tab) { return JSON.stringify({ ok: false, error: 'no text editor is active' }); }
	// The tab's label names the full path, then any problems: /x/doc.qmd \u2022 1 problem in this file.
	const path = (tab.querySelector('.monaco-icon-label')?.getAttribute('aria-label') || '').split(' \u2022 ')[0];
	return JSON.stringify({ ok: true, path, name: clean(tab.querySelector('.label-name')), dirty: tab.classList.contains('dirty') });
})()"
READ_JS="(() => {$COMMON
	if (!ed) { return JSON.stringify({ ok: false, error: 'no text editor is active' }); }
	const ls = nums();
	const outputs = [...ed.querySelectorAll('.quarto-inline-output')].filter(o => o.offsetParent !== null).map(o => {
		const kinds = [...new Set([...o.querySelectorAll('[class*=\"quarto-output-\"]').values()].flatMap(e => [...e.classList])
			.map(c => (c.match(/^quarto-output-(stdout|stderr|error|image|html|webview-container|data-explorer|truncation-header)$/) || [])[1]).filter(Boolean))];
		const w = o.closest('.quarto-inline-output-wrapper') || o;
		const icon = w.querySelector('.code-cell-footer-icon');
		const status = ['running', 'pending', 'success', 'error'].find(s => icon?.classList.contains(s));
		const above = lineAbove(o);
		return { afterLine: above ?? (ls.length && o.getBoundingClientRect().top < Math.min(...ls.map(l => l.top)) ? 'above view' : null), status, footer: [...(w.querySelector('.code-cell-footer-text')?.children || [])].map(clean).filter(Boolean).join(' | ') || undefined,
			kinds, collapsed: !!o.querySelector('.quarto-output-summary') && o.querySelector('.quarto-output-content')?.offsetParent === null,
			text: (o.querySelector('.quarto-output-content')?.innerText || '').replace(/\\u00A0/g, ' ').trim().slice(0, 2000) };
	});
	return JSON.stringify({ ok: true, tab: clean(tab?.querySelector('.label-name')),
		visible: ls.length ? Math.min(...ls.map(l => l.n)) + '-' + Math.max(...ls.map(l => l.n)) : null,
		cells: toolbars().map(({ el, ...t }) => t), outputs });
})()"

# The cells of the saved file, from its fences.
cells() {
	local f path
	f=$(run_js "$FILE_JS") || { echo "$f"; return 1; }
	ok "$f" || { echo "$f"; return 1; }
	path=$(echo "$f" | jq -r '.path')
	# A file under the home folder shows as ~/... on its tab.
	[[ "$path" == "~/"* ]] && path="$HOME/${path#\~/}"
	[[ -f "$path" ]] || { echo "$f" | jq -c '{ok: false, error: ("cannot find the file on disk: " + .path + "; save it first")}'; return 1; }
	awk -v dirty="$(echo "$f" | jq -r '.dirty')" -v name="$(echo "$f" | jq -r '.name')" '
		BEGIN { n = 0; open = 0; out = "" }
		!open && /^[ \t]*```+[ \t]*\{[a-zA-Z]/ { n++; open = 1; lang = $0; sub(/^[^{]*\{/, "", lang); sub(/[ ,}].*$/, "", lang);
			out = out (n > 1 ? "," : "") "{\"n\":" n ",\"language\":\"" lang "\",\"fenceLine\":" NR ",\"firstCodeLine\":" NR + 1; next }
		open && /^[ \t]*```+[ \t]*$/ { open = 0; out = out ",\"endLine\":" NR "}"; next }
		END { if (open) { out = out "}" } printf "{\"ok\":true,\"file\":\"%s\",\"dirty\":%s,\"cells\":[%s]}\n", name, dirty, out }
	' "$path"
}
# Sets LINE (the opening fence) and END (the closing fence) of cell $1.
cell_info() {
	local c
	c=$(cells) || { echo "$c"; return 1; }
	LINE=$(echo "$c" | jq -r --argjson n "$1" '.cells[] | select(.n == $n) | .fenceLine')
	END=$(echo "$c" | jq -r --argjson n "$1" '.cells[] | select(.n == $n) | .endLine // .fenceLine')
	[[ "$LINE" =~ ^[0-9]+$ ]] || { echo "{\"ok\":false,\"error\":\"no cell $1 in the saved file\"}"; return 1; }
}
# Whether cell $1's toolbar is on screen now (it shows only near the cursor).
on_screen() {
	run_js "(() => {$COMMON return JSON.stringify({ ok: !!ed && toolbars().some(x => x.line === $LINE) }); })()" | jq -r '.ok'
}
goto_cell() {
	"$DIR/editor.sh" "${SFLAG[@]}" goto $((LINE + 1)) >/dev/null || { echo '{"ok":false,"error":"could not go to the cell"}'; return 1; }
	sleep 0.3
}
# Brings cell N on screen and marks its toolbar button labelled $2 (empty: the run/stop button).
mark() {
	local line m
	cell_info "$1" || return 1
	line=$LINE
	[[ "$(on_screen)" == true ]] || goto_cell || return 1
	m=$(run_js "(() => {$COMMON
		const t = toolbars().find(x => x.line === $line);
		if (!t) { return JSON.stringify({ ok: false, error: 'no toolbar on line $line; is inline output on (quarto.inlineOutput.enabled)?' }); }
		const want = $(jq -Rn --arg v "$2" '$v');
		const b = want ? [...t.el.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === want) : t.el.querySelector('.quarto-toolbar-run');
		if (!b) { return JSON.stringify({ ok: false, error: 'no button ' + want, buttons: [...t.el.querySelectorAll('button')].map(x => x.getAttribute('aria-label')) }); }
		if (b.disabled) { return JSON.stringify({ ok: false, error: b.getAttribute('aria-label') + ' is disabled' }); }
		b.setAttribute('data-dp-target', '1');
		return JSON.stringify({ ok: true, line: $line, state: t.state, button: b.getAttribute('aria-label') });
	})()") || { echo "$m"; return 1; }
	echo "$m"
	ok "$m"
}
# Cell $1's toolbar state and the output under its closing fence; brings it on
# screen first, since off-screen cells and outputs are not in the page.
cell_state() {
	[[ -n "${LINE:-}" ]] || cell_info "$1" >/dev/null || { echo "{\"ok\":false,\"error\":\"no cell $1 in the saved file\"}"; return 1; }
	[[ "$(on_screen)" == true ]] || goto_cell >/dev/null
	run_js "$READ_JS" | jq -c --argjson l "$LINE" --argjson e "$END" --argjson n "$1" '{ok: .ok, cell: $n, fenceLine: $l} + ((.cells[] | select(.line == $l) | {state, run}) // {state: "not on screen"}) + {output: ([.outputs[] | select(.afterLine == $e)][0] // null)}'
}

case "$CMD" in
	cells) cells ;;
	read) run_js "$READ_JS" ;;
	run|stop|button)
		[[ "$N" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the cell number, 1 = first"}'; exit 2; }
		LABEL=""
		[[ "$CMD" == button ]] && { LABEL="$A2"; [[ -n "$LABEL" ]] || { echo '{"ok":false,"error":"give the button label"}'; exit 2; }; }
		M=$(mark "$N" "$LABEL") || { echo "$M"; exit 1; }
		B=$(echo "$M" | jq -r '.button')
		if [[ "$CMD" == run && "$B" != "Run this cell" ]]; then echo "$M" | jq -c '{ok: false, error: ("the cell is " + .state + "; its button is " + .button)}'; exit 1; fi
		if [[ "$CMD" == stop && "$B" == "Run this cell" ]]; then echo "$M" | jq -c '{ok: false, error: "the cell is not running or queued"}'; exit 1; fi
		# Click only while the button still has that label: a cell that finishes
		# between the check and the click turns Stop back into Run.
		if ! pw click "[data-dp-target=\"1\"][aria-label=\"$B\"]" >/dev/null 2>&1; then
			cell_state "$N" | jq -c --arg b "$B" '. + {ok: false, error: ("the button stopped being \"" + $b + "\" before the click (the cell finished or started); nothing was clicked")}'
			exit 1
		fi
		log_action "qmd.sh" "cell $N: click $B"
		sleep 0.8
		cell_state "$N" | jq -c --arg b "$B" '. + {clicked: $b}' ;;
	wait)
		[[ "$N" =~ ^[0-9]+$ ]] || { echo '{"ok":false,"error":"give the cell number"}'; exit 2; }
		END=$(( $(date +%s) + ${A2:-60} ))
		while (( $(date +%s) <= END )); do
			S=$(cell_state "$N")
			case "$(echo "$S" | jq -r '.state')" in idle|completed|error) echo "$S"; exit 0 ;; esac
			sleep 1
		done
		echo "$S" | jq -c --arg t "${A2:-60}" '. + {ok: false, error: ("still queued or running after " + $t + " s")}'
		exit 1 ;;
	*) echo '{"ok":false,"error":"command: cells, read, run, wait, stop or button"}'; exit 2 ;;
esac
