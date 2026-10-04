#!/usr/bin/env bash
# Starts a new console session for a language and waits until its console is
# ready for input. The console's Quick Launch control opens a menu, not a quick
# pick, and its references change between snapshots, so this goes through the
# Command Palette instead: Interpreter: Start New Console Session, then the
# runtime picker row that names the language (and --name, when several
# interpreters of that language are installed).
#
# Usage:
#   scripts/start-session.sh --session NAME --language r
#   scripts/start-session.sh --session NAME --language python --name 3.14.6
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --language LANG  python or r
#   --name TEXT      words the picker row must also hold, such as a version or
#                    "uv"; needed only when several interpreters match
#   --timeout SECS   how long to wait for the console to be ready (default 60)
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"runtime":"R 4.5.1","sessionId":"r-1a2b3c4d","session":"R 4.5.1"}
# The sessionId is what console tabs and the MCP tools name the session by.
# Exit code: 0 when the console is ready, 1 when it is not, 2 on a usage error.
#
# Required tools on PATH: node, jq.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SESSION=""
LANGUAGE=""
NAME=""
TIMEOUT=60
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--language) LANGUAGE="$(echo "$2" | tr '[:upper:]' '[:lower:]')"; shift 2 ;;
		--name) NAME="$2"; shift 2 ;;
		--timeout) TIMEOUT="$2"; shift 2 ;;
		-h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "start-session.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
if [[ "$LANGUAGE" != "python" && "$LANGUAGE" != "r" ]]; then
	echo '{"ok":false,"error":"--language must be python or r"}'
	exit 2
fi
pw_setup "$SESSION"
HERE="$(dirname "${BASH_SOURCE[0]}")"
page() { node "$HERE/quickpick-page.ts" "$@"; }

# The consoles of this language before, so the new one can be told apart.
TABS_JS="(() => JSON.stringify({ ok: true, ids: [...document.querySelectorAll('[data-testid^=\"console-tab-$LANGUAGE-\"]')].map(t => t.getAttribute('data-testid').replace('console-tab-', '')), active: (document.querySelector('.console-instance[style*=\"z-index: auto\"]')?.getAttribute('data-testid') || '').replace(/^console-/, '') }))()"
BEFORE=$(run_js "$TABS_JS") || { echo "$BEFORE"; exit 1; }

OPENED=$("$HERE/palette-run.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} 'Interpreter: Start New Console Session') || { echo "$OPENED"; exit 1; }
# The runtime picker rows read like "R 4.5.1" or "Python 3.14.6 (uv: positron-python)".
LANG_WORD=$([[ "$LANGUAGE" == "r" ]] && echo "R" || echo "Python")
for i in 1 2 3 4 5 6 7 8 9 10; do
	OPEN=$(run_js "$(page open)") && [[ "$(echo "$OPEN" | jq -r '.ok')" == "true" ]] && break
	sleep 0.3
done
# "R" alone would match any label holding an r, so match the language word at
# the start of the label in the page, then any --name words.
CHOSEN=$(run_js "$(page choose words "$LANG_WORD ${NAME}")") || { echo "$CHOSEN"; pw press Escape >/dev/null 2>&1; exit 1; }
if [[ "$(echo "$CHOSEN" | jq -r '.ok')" != "true" ]]; then
	pw press Escape >/dev/null 2>&1
	echo "$CHOSEN"
	exit 1
fi
RUNTIME=$(echo "$CHOSEN" | jq -r '.chosen')
if [[ "$RUNTIME" != "$LANG_WORD "* ]]; then
	echo "$CHOSEN" | jq -c '. + {ok: false, error: ("the matching row is not a " + $l + " interpreter: " + .chosen)}' --arg l "$LANG_WORD"
	exit 1
fi
log_action "start-session.sh" "$RUNTIME"

# Ready: a new console tab of this language is active and its input is there,
# with no interrupt button showing.
DEADLINE=$(( $(date +%s) + TIMEOUT ))
WAIT_JS="(() => {
	const before = $(echo "$BEFORE" | jq -c '.ids');
	const tabs = [...document.querySelectorAll('[data-testid^=\"console-tab-$LANGUAGE-\"]')];
	const fresh = tabs.map(t => t.getAttribute('data-testid').replace('console-tab-', '')).filter(id => !before.includes(id));
	const active = (document.querySelector('.console-instance[style*=\"z-index: auto\"]')?.getAttribute('data-testid') || '').replace(/^console-/, '');
	// With one session there are no tabs; the active console is the new one.
	const id = fresh[0] || (tabs.length === 0 && active.startsWith('$LANGUAGE-') && !before.includes(active) ? active : '');
	const inst = id ? document.querySelector('[data-testid=\"console-' + id + '\"]') : null;
	const ready = !!inst && !!inst.querySelector('.console-input .native-edit-context') && !document.querySelector('.codicon-positron-interrupt-runtime');
	const tab = id ? document.querySelector('[data-testid=\"console-tab-' + id + '\"]') : null;
	return JSON.stringify({ ok: ready, sessionId: id || null, session: tab?.getAttribute('aria-label') || null });
})()"
while (( $(date +%s) <= DEADLINE )); do
	STATE=$(run_js "$WAIT_JS") || { echo "$STATE"; exit 1; }
	if [[ "$(echo "$STATE" | jq -r '.ok')" == "true" ]]; then
		echo "$STATE" | jq -c --arg r "$RUNTIME" '{ok: true, runtime: $r, sessionId, session}'
		exit 0
	fi
	# A dialog (create a virtual environment?) holds start-up until answered.
	P=$("$(dirname "${BASH_SOURCE[0]}")/notifications.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} 2>/dev/null | jq -c '[.notifications[]? | select(.kind == "dialog")]' 2>/dev/null)
	if [[ -n "$P" && "$P" != "[]" ]]; then
		echo "$STATE" | jq -c --arg r "$RUNTIME" --argjson p "$P" '{ok: false, runtime: $r, sessionId, error: "a dialog is waiting for an answer; answer it with notifications.sh --click, then run this again or wait for the console", dialogs: $p}'
		exit 1
	fi
	sleep 1
done
echo "$STATE" | jq -c --arg r "$RUNTIME" --arg t "$TIMEOUT" '{ok: false, runtime: $r, sessionId, error: ("the console was not ready within " + $t + " s")}'
exit 1
