#!/usr/bin/env bash
# Reads and runs cells in the Positron notebook editor, for the notebook you
# name. Each command checks that notebook is the active editor first and refuses
# otherwise, since a cell action on whichever notebook is in front runs code in
# the wrong file.
#
# Usage:
#   scripts/nb.sh --session NAME --notebook py.ipynb read
#   scripts/nb.sh --session NAME --notebook py.ipynb run 3
#   scripts/nb.sh --session NAME --notebook py.ipynb wait
#
# Commands:
#   read      every cell: number, kind, execution count, state (running,
#             pending, success, error), its source's first line, and its
#             outputs' text (cut at 400 characters), error flag and image count;
#             plus the kernel badge's text and whether the tab is modified
#   run N     run cell N (1-based) with its own Run button
#   wait      wait until no cell is running or pending (up to --timeout, default 60 s)
#   ready     wait until the kernel badge shows the kernel idle (after a start,
#             restart or kernel change; up to --timeout)
#   kernel W  change the kernel to the picker row holding every word of W, such
#             as "R 4.5.1" or "3.14.6 uv"; refuses when no picker opens, so
#             nothing is typed into the notebook
#   restart | interrupt | clear
#             restart the kernel, interrupt it, or clear all outputs (a restart
#             of a busy kernel asks first: answer it with notifications.sh)
#   move N up|down
#             select cell N and move it
#
# Flags:
#   --editor N  with the same notebook open in a split, the Nth editor from the
#               left; read, run and wait act on that one
#
# Open the notebook first (open-file.sh). Run a whole notebook with
# palette-run.sh 'Notebook: Run All Cells', which refuses while a cell runs.
#
# Stdout: one JSON line. Exit code: 0 on success, 1 when the notebook is not the
# active editor or the cell is not there, 2 on a usage error.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
NOTEBOOK=""
TIMEOUT=60
CMD=""
ARG=""
ARG2=""
EDITOR_N=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--notebook) NOTEBOOK="$2"; shift 2 ;;
		--timeout) TIMEOUT="$2"; shift 2 ;;
		--editor) EDITOR_N="$2"; shift 2 ;;
		-h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) if [[ -z "$CMD" ]]; then CMD="$1"; elif [[ -z "$ARG" ]]; then ARG="$1"; else ARG2="$1"; fi; shift ;;
	esac
done
if [[ -z "$NOTEBOOK" || -z "$CMD" ]]; then
	echo '{"ok":false,"error":"give --notebook NAME and a command: read, run N or wait"}'
	exit 2
fi
pw_setup "$SESSION"

COMMON="
	const WANT = $(jq -Rn --arg v "$(basename "$NOTEBOOK")" '$v');
	const clean = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
	// With --editor N, the Nth group from the left showing this notebook; else the active group.
	const groups = [...document.querySelectorAll('.editor-group-container')].filter(g => g.offsetParent !== null)
		.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
	const showing = groups.filter(g => clean(g.querySelector('.tab.active .label-name')) === WANT);
	const N = $EDITOR_N;
	const group = N > 0 ? showing[N - 1] : document.querySelector('.editor-group-container.active');
	const tab = group?.querySelector('.tab.active');
	const active = N > 0 && !group ? 'none of ' + showing.length + ' editors' : clean(tab?.querySelector('.label-name'));
	const editor = group?.querySelector('.positron-notebook');
	const cells = editor ? [...editor.querySelectorAll('[role=article]')] : [];
	const state = c => ['running', 'pending', 'error', 'success'].find(s => c.querySelector('.code-cell-footer-icon.' + s)) || '';
	const guard = () => active !== WANT ? 'the active editor is ' + (active || 'none') + ', not ' + WANT + '; open it with open-file.sh'
		: !editor ? WANT + ' is not open in the Positron notebook editor' : '';
"
HERE="$(dirname "${BASH_SOURCE[0]}")"
# Runs the first of several palette titles that is listed: the notebook's
# commands sit under "Notebook:" or "Positron Notebook:" depending on the action.
palette_first() {
	local t
	for t in "$@"; do
		if "$HERE/palette-run.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} --dry-run "$t" >/dev/null 2>&1; then
			"$HERE/palette-run.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} "$t"
			return $?
		fi
	done
	printf '{"ok":false,"error":"none of these commands is listed now: %s"}\n' "$*"
	return 1
}
GUARD_JS="(() => {$COMMON const g = guard(); return JSON.stringify({ ok: !g, error: g || undefined }); })()"
# Clicks a button in the notebook editor's own toolbar by its label, with a real
# click: interrupt and the cell commands are not in the palette for this editor.
toolbar_click() {
	local m
	m=$(run_js "(() => {$COMMON document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
		const want = $(jq -Rn --arg v "$1" '$v');
		const b = [...group.querySelectorAll('.title [aria-label]')].filter(e => e.offsetParent !== null).find(e => e.getAttribute('aria-label') === want);
		if (!b) { return JSON.stringify({ ok: false, error: 'the notebook toolbar has no ' + want + ' button now' }); }
		b.setAttribute('data-dp-target', '1'); return JSON.stringify({ ok: true, button: want }); })()") || { echo "$m"; return 1; }
	[[ "$(echo "$m" | jq -r '.ok')" == "true" ]] || { echo "$m"; return 1; }
	pw click '[data-dp-target="1"]' >/dev/null 2>&1
	run_js "(() => { document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target')); return '{}'; })()" >/dev/null
	log_action "nb.sh" "$1 in $(basename "$NOTEBOOK")"
	echo "$m"
}
case "$CMD" in
	restart|interrupt|clear|kernel|move)
		G=$(run_js "$GUARD_JS") || { echo "$G"; exit 1; }
		[[ "$(echo "$G" | jq -r '.ok')" == "true" ]] || { echo "$G"; exit 1; }
		case "$CMD" in
			restart) toolbar_click 'Restart Kernel'; exit $? ;;
			interrupt) toolbar_click 'Stop Execution'; exit $? ;;
			clear) toolbar_click 'Clear All Outputs'; exit $? ;;
			kernel)
				[[ -n "$ARG" ]] || { echo '{"ok":false,"error":"kernel needs the words of the picker row, such as \"R 4.5.1\""}'; exit 2; }
				palette_first 'Positron Notebook: Change Kernel...' 'Notebook: Change Kernel...' 'Notebook: Select Notebook Kernel' >/dev/null || { echo '{"ok":false,"error":"no Change Kernel command is listed"}'; exit 1; }
				PICKER=false
				for _ in 1 2 3 4 5 6 7 8 9 10; do
					OPEN=$(run_js "$(node "$HERE/quickpick-page.ts" open)") && [[ "$(echo "$OPEN" | jq -r '.ok')" == "true" ]] && { PICKER=true; break; }
					sleep 0.3
				done
				# No picker, no typing: keys sent now would edit the notebook.
				[[ "$PICKER" == true ]] || { echo '{"ok":false,"error":"the kernel picker did not open; nothing was typed"}'; exit 1; }
				CH=$(run_js "$(node "$HERE/quickpick-page.ts" choose words "$ARG" --dry)") || { echo "$CH"; pw press Escape >/dev/null 2>&1; exit 1; }
				if [[ "$(echo "$CH" | jq -r '.ok')" != "true" ]]; then pw press Escape >/dev/null 2>&1; echo "$CH"; exit 1; fi
				pw press Enter >/dev/null 2>&1
				log_action "nb.sh" "kernel $(echo "$CH" | jq -r '.chosen') for $(basename "$NOTEBOOK")"
				echo "$CH" | jq -c '{ok: true, kernel: .chosen, description}'
				exit 0 ;;
			move)
				[[ "$ARG" =~ ^[0-9]+$ && ( "$ARG2" == up || "$ARG2" == down ) ]] || { echo '{"ok":false,"error":"move N up|down"}'; exit 2; }
				# The cell's More Cell Actions menu has Move Cell Up and Down.
				# The cell's action bar shows only under a real mouse, so hover the cell first.
				M=$(run_js "(() => {$COMMON document.querySelectorAll('[data-dp-target]').forEach(e => e.removeAttribute('data-dp-target'));
					const c = cells[$ARG - 1]; if (!c) { return JSON.stringify({ ok: false, error: 'the notebook has ' + cells.length + ' cells' }); }
					c.scrollIntoView({ block: 'center' });
					c.setAttribute('data-dp-target', '1');
					return JSON.stringify({ ok: true }); })()") || { echo "$M"; exit 1; }
				[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
				pw hover '[data-dp-target="1"]' >/dev/null 2>&1
				M=$(run_js "(() => {$COMMON const c = cells[$ARG - 1]; c.removeAttribute('data-dp-target');
					const more = c.querySelector('[aria-label=\"More Cell Actions\"]');
					if (!more) { return JSON.stringify({ ok: false, error: 'cell $ARG has no More Cell Actions button' }); }
					more.setAttribute('data-dp-target', '1');
					return JSON.stringify({ ok: true }); })()") || { echo "$M"; exit 1; }
				[[ "$(echo "$M" | jq -r '.ok')" == "true" ]] || { echo "$M"; exit 1; }
				pw click '[data-dp-target="1"]' >/dev/null 2>&1
				T=$([[ "$ARG2" == up ]] && echo 'Move Cell Up' || echo 'Move Cell Down')
				CH=$(run_js "$(node "$HERE/tree-page.ts" menu-mark "$T")") || { echo "$CH"; pw press Escape >/dev/null 2>&1; exit 1; }
				[[ "$(echo "$CH" | jq -r '.ok')" == "true" ]] || { pw press Escape >/dev/null 2>&1; echo "$CH"; exit 1; }
				pw click '[data-dp-target="1"]' >/dev/null 2>&1
				log_action "nb.sh" "$T for cell $ARG in $(basename "$NOTEBOOK")"
				echo "$CH" | jq -c '{ok: true, moved: .item}'; exit 0 ;;
		esac ;;
	ready)
		JS="(() => {$COMMON
			const g = guard(); if (g) { return JSON.stringify({ ok: false, error: g }); }
			const badge = group.querySelector('.positron-notebook-kernel-status-badge');
			const status = ((badge?.querySelector('[data-testid^=runtime-status-]') || {}).getAttribute?.('data-testid') || '').replace('runtime-status-', '');
			return JSON.stringify({ ok: status === 'idle', status, kernel: clean(badge) });
		})()"
		END=$(( $(date +%s) + TIMEOUT ))
		while (( $(date +%s) <= END )); do
			RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
			[[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]] && { echo "$RESULT"; exit 0; }
			[[ -n "$(echo "$RESULT" | jq -r '.error // empty')" ]] && { echo "$RESULT"; exit 1; }
			sleep 0.5
		done
		echo "$RESULT" | jq -c --arg t "$TIMEOUT" '. + {error: ("the kernel is not idle after " + $t + " s")}'
		exit 1 ;;
	read)
		JS="(() => {$COMMON
			const g = guard(); if (g) { return JSON.stringify({ ok: false, error: g }); }
			const out = cells.map((c, i) => {
				const code = !!c.querySelector('.positron-notebook-code-cell-contents');
				const outs = code ? c.querySelector('.positron-notebook-cell-outputs') : null;
				// A markdown cell shows its rendered text unless it is being edited.
				const lines = [...c.querySelectorAll('.view-line')].map(l => l.textContent.replace(/\\u00A0/g, ' '));
				const rendered = !code && !lines.length ? (c.querySelector('.positron-notebook-markdown-rendered, .markdown, .cell-contents') || c).innerText.split('\\n').map(l => l.trim()) : [];
				const src = lines.length ? lines : rendered;
				return {
					cell: i + 1,
					kind: code ? 'code' : 'markdown',
					count: clean(c.querySelector('.execution-order-badge')) || null,
					state: state(c),
					source: src.find(l => l.trim()) || '',
					lines: src.length,
					output: outs ? outs.innerText.replace(/\\s+\\n/g, '\\n').trim().slice(0, 400) : '',
					error: !!c.querySelector('.notebook-error'),
					images: outs ? outs.querySelectorAll('img').length : 0,
				};
			});
			return JSON.stringify({ ok: true, notebook: WANT, modified: !!tab?.classList.contains('dirty'), kernel: clean(document.querySelector('.editor-group-container.active .positron-notebook-kernel-status-badge')), cells: out });
		})()" ;;
	run)
		if [[ ! "$ARG" =~ ^[0-9]+$ ]]; then echo '{"ok":false,"error":"run needs a cell number"}'; exit 2; fi
		JS="(async () => {$COMMON
			const g = guard(); if (g) { return JSON.stringify({ ok: false, error: g }); }
			const c = cells[$ARG - 1];
			if (!c) { return JSON.stringify({ ok: false, error: 'the notebook has ' + cells.length + ' cells' }); }
			c.scrollIntoView({ block: 'center' });
			c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			await new Promise(r => setTimeout(r, 150));
			const button = [...c.querySelectorAll('[aria-label]')].find(b => /^(Run|Execute) Cell\\b/i.test(b.getAttribute('aria-label')));
			if (!button) { return JSON.stringify({ ok: false, error: 'cell $ARG has no Run Cell button (a markdown cell, or the button label changed)' }); }
			button.click();
			return JSON.stringify({ ok: true, notebook: WANT, ran: $ARG });
		})()" ;;
	wait)
		JS="(() => {$COMMON
			const g = guard(); if (g) { return JSON.stringify({ ok: false, error: g }); }
			const busy = cells.map((c, i) => [i + 1, state(c)]).filter(([, s]) => s === 'running' || s === 'pending').map(([n]) => n);
			return JSON.stringify({ ok: busy.length === 0, busy });
		})()" ;;
	*) echo '{"ok":false,"error":"unknown command '"$CMD"'"}'; exit 2 ;;
esac

if [[ "$CMD" == "wait" ]]; then
	# Idle on two reads at least a second after starting: a cell clicked just
	# before can take a moment to show as running.
	START=$(date +%s); END=$(( START + TIMEOUT )); IDLE=0
	while (( $(date +%s) <= END )); do
		RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
		if [[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]; then
			IDLE=$(( IDLE + 1 ))
			(( IDLE >= 2 && $(date +%s) - START >= 1 )) && { echo "$RESULT"; exit 0; }
		else
			IDLE=0
		fi
		[[ "$(echo "$RESULT" | jq -r '.error // empty')" != "" ]] && { echo "$RESULT"; exit 1; }
		sleep 0.5
	done
	echo "$RESULT" | jq -c --arg t "$TIMEOUT" '. + {error: ("cells still running after " + $t + " s")}'
	exit 1
fi
RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
[[ "$CMD" == "run" && "$(echo "$RESULT" | jq -r '.ok')" == "true" ]] && log_action "nb.sh" "run cell $ARG in $(basename "$NOTEBOOK")"
echo "$RESULT"
[[ "$(echo "$RESULT" | jq -r '.ok')" == "true" ]]
