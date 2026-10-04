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
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--notebook) NOTEBOOK="$2"; shift 2 ;;
		--timeout) TIMEOUT="$2"; shift 2 ;;
		-h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) if [[ -z "$CMD" ]]; then CMD="$1"; else ARG="$1"; fi; shift ;;
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
	const tab = document.querySelector('.editor-group-container.active .tab.active');
	const active = clean(tab?.querySelector('.label-name'));
	const editor = document.querySelector('.editor-group-container.active .positron-notebook');
	const cells = editor ? [...editor.querySelectorAll('[role=article]')] : [];
	const state = c => ['running', 'pending', 'error', 'success'].find(s => c.querySelector('.code-cell-footer-icon.' + s)) || '';
	const guard = () => active !== WANT ? 'the active editor is ' + (active || 'none') + ', not ' + WANT + '; open it with open-file.sh'
		: !editor ? WANT + ' is not open in the Positron notebook editor' : '';
"
case "$CMD" in
	read)
		JS="(() => {$COMMON
			const g = guard(); if (g) { return JSON.stringify({ ok: false, error: g }); }
			const out = cells.map((c, i) => {
				const outs = c.querySelector('.positron-notebook-cell-outputs');
				const src = [...c.querySelectorAll('.view-line')].map(l => l.textContent.replace(/\\u00A0/g, ' '));
				return {
					cell: i + 1,
					kind: c.querySelector('.positron-notebook-code-cell-contents') ? 'code' : 'markdown',
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
