#!/usr/bin/env bash
# Prints the text of one session's console, without switching to it. Reading
# `.console-instance` text from the page joins every console together, and a
# console the Run App button starts is named after the app ("Shiny"), not the
# language, so this picks the console by language or by part of its name.
#
# Usage:
#   scripts/console-read.sh --session NAME --language r
#   scripts/console-read.sh --session NAME --name Shiny --tail 20
#   scripts/console-read.sh --session NAME --language python --after 'df.describe()'
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --language LANG  python or r
#   --name TEXT      part of the console's name, as its tab shows it, or its
#                    session id (r-9760fdda) when two share a name; with
#                    --language, narrows to one of several sessions
#   --tail N         print only the last N lines (default 40; 0 for all)
#   --after TEXT     print only what follows the last line that holds TEXT,
#                    such as the code you just ran
#   --prompt         print only the prompt the console's input shows now:
#                    R's ">" or "Browse[1]>" while paused in the debugger, "+"
#                    mid-expression; Python's ">>>"
#
# With no --language or --name, it reads the active console.
#
# Stdout: the console text, then nothing else. Stderr: which console it read,
# and its prompt.
# Exit code: 0 when it read a console, 1 when none matched, 2 on a usage error.
#
# Required tools on PATH: jq.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
LANGUAGE=""
NAME=""
TAIL=40
AFTER=""
PROMPT_ONLY=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--language) LANGUAGE="$(echo "$2" | tr '[:upper:]' '[:lower:]')"; shift 2 ;;
		--name) NAME="$2"; shift 2 ;;
		--tail) TAIL="$2"; shift 2 ;;
		--after) AFTER="$2"; shift 2 ;;
		--prompt) PROMPT_ONLY=1; shift ;;
		-h|--help) sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "console-read.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
if [[ -n "$LANGUAGE" && "$LANGUAGE" != "python" && "$LANGUAGE" != "r" ]]; then
	echo "console-read.sh: --language must be python or r" >&2
	exit 2
fi
pw_setup "$SESSION"

JS="(() => {
	const LANG = $(jq -Rn --arg v "$LANGUAGE" '$v');
	const NAME = $(jq -Rn --arg v "$NAME" '$v');
	const idOf = el => (el?.getAttribute('data-testid') || '').replace(/^console-(tab-)?/, '');
	const active = document.querySelector('.console-instance[style*=\"z-index: auto\"]');
	const tabs = [...document.querySelectorAll('[data-testid^=\"console-tab-\"]')]
		.filter(t => (!LANG || idOf(t).startsWith(LANG + '-')) && (!NAME || (t.getAttribute('aria-label') || '').includes(NAME) || idOf(t) === NAME));
	let id;
	if (!LANG && !NAME) { id = idOf(active); }
	else if (tabs.length === 1) { id = idOf(tabs[0]); }
	else if (tabs.length > 1) { return JSON.stringify({ ok: false, error: tabs.length + ' consoles match; narrow with --name, by name or id: ' + tabs.map(t => t.getAttribute('aria-label') + ' (' + idOf(t) + ')').join(', ') }); }
	else if (!document.querySelector('[data-testid^=\"console-tab-\"]') && LANG && idOf(active).startsWith(LANG + '-')) { id = idOf(active); }
	if (!id) { return JSON.stringify({ ok: false, error: 'no console matches' }); }
	const inst = document.querySelector('[data-testid=\"console-' + id + '\"]');
	if (!inst) { return JSON.stringify({ ok: false, error: 'console ' + id + ' is not in the page' }); }
	// The input editor's own text is not output, so drop it from the end.
	const box = inst.querySelector('.console-instance-container') || inst;
	let text = box.innerText;
	const typed = inst.querySelector('.console-input')?.innerText || '';
	if (typed && text.endsWith(typed)) { text = text.slice(0, -typed.length); }
	const tab = document.querySelector('[data-testid=\"console-tab-' + id + '\"]');
	// The prompt the input shows now: R's is Browse[1]> while debugging, + mid-expression.
	const prompt = (inst.querySelector('.console-input .line-numbers.active-line-number') || inst.querySelector('.console-input .line-numbers'))?.textContent.trim() || null;
	return JSON.stringify({ ok: true, sessionId: id, session: tab?.getAttribute('aria-label') || id, prompt, text: text.replace(/\\u00A0/g, ' ') });
})()"
ensure_console_view
RESULT=$(run_js "$JS") || { echo "$RESULT" >&2; exit 1; }
if [[ "$(echo "$RESULT" | jq -r '.ok')" != "true" ]]; then
	echo "console-read.sh: $(echo "$RESULT" | jq -r '.error')" >&2
	exit 1
fi
echo "console-read.sh: $(echo "$RESULT" | jq -r '.session') ($(echo "$RESULT" | jq -r '.sessionId')), prompt $(echo "$RESULT" | jq -r '.prompt')" >&2
if [[ "$PROMPT_ONLY" == 1 ]]; then
	echo "$RESULT" | jq -r '.prompt'
	exit 0
fi
TEXT=$(echo "$RESULT" | jq -r '.text')
if [[ -n "$AFTER" ]]; then
	# ENVIRON, not -v: awk -v turns a \n in the code into a newline, and the line never matches.
	TEXT=$(printf '%s\n' "$TEXT" | NEEDLE="$AFTER" awk 'index($0, ENVIRON["NEEDLE"]) { buf = ""; found = 1; next } found { buf = buf $0 "\n" } END { printf "%s", buf }')
fi
if [[ "$TAIL" != "0" ]]; then
	printf '%s\n' "$TEXT" | tail -n "$TAIL"
else
	printf '%s\n' "$TEXT"
fi
