#!/usr/bin/env bash
# Runs code in the console of a named language's session, and checks it landed
# there. With a Python and an R session open, the active console is whichever
# was used last, so typing into "the console" sends R code to Python as often
# as not. This script picks the session's console first, pastes into its input,
# presses Enter, and confirms the code was echoed in that console.
#
# It does not start a session: start one first, and the script fails if there
# is none for the language.
#
# Usage:
#   scripts/console-run.sh --session NAME --language r 'x <- 1:10'
#   echo 'import pandas as pd' | scripts/console-run.sh --session NAME --language python
#   scripts/console-run.sh --session NAME --language r --name "R 4.5.1" 'x'   # pick one of several R sessions
#   scripts/console-run.sh --session NAME --language python --no-enter 'df.'  # paste without running
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --language LANG  python or r
#   --name TEXT      part of the session's name, as its console tab shows it,
#                    or its session id (r-9760fdda) when two share a name;
#                    needed only when several sessions share the language
#   --no-enter       paste the code but do not run it
#   --timeout SECS   how long to wait for the code to echo (default 10)
#   --capture        also wait for the code to finish (up to --capture-timeout,
#                    default 60 s) and return what it printed, as "output"
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"session":"R 4.5.1","sessionId":"r-cf28f473","switched":true,"busy":false,"echoed":true}
# Exit code: 0 when the code landed in the right console, 1 when it did not, 2 on a usage error.
#
# Required tools on PATH: node, jq.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PW_CLI=("$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/node_modules/.bin/playwright-cli")
if [[ ! -x "${PW_CLI[0]}" ]]; then
	PW_CLI=(npx @playwright/cli)
fi

LANGUAGE=""
NAME=""
ENTER=1
TIMEOUT=10
CAPTURE=0
CAPTURE_TIMEOUT=60
TEXT_ARG=""
PW_SESSION_OVERRIDE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) PW_SESSION_OVERRIDE="$2"; shift 2 ;;
		--session=*) PW_SESSION_OVERRIDE="${1#--session=}"; shift ;;
		--language) LANGUAGE="$(echo "$2" | tr '[:upper:]' '[:lower:]')"; shift 2 ;;
		--name) NAME="$2"; shift 2 ;;
		--no-enter) ENTER=0; shift ;;
		--timeout) TIMEOUT="$2"; shift 2 ;;
		--capture) CAPTURE=1; shift ;;
		--capture-timeout) CAPTURE_TIMEOUT="$2"; shift 2 ;;
		-h|--help) sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		--) shift; TEXT_ARG="${*-}"; break ;;
		-*) echo "console-run.sh: unknown flag $1" >&2; exit 2 ;;
		*) TEXT_ARG="$1"; shift ;;
	esac
done

if [[ "$LANGUAGE" != "python" && "$LANGUAGE" != "r" ]]; then
	echo '{"ok":false,"error":"--language must be python or r"}'
	exit 2
fi
for tool in node jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		printf '{"ok":false,"error":"%s not on PATH"}\n' "$tool"
		exit 2
	fi
done

SESSION="${PW_SESSION_OVERRIDE:-${PW_SESSION:-}}"
PW_ARGS=()
[[ -n "$SESSION" ]] && PW_ARGS=("-s=$SESSION")
PW_SESSION_NAME="$SESSION"

if [[ -n "${TEXT_ARG:-}" ]]; then
	TEXT="$TEXT_ARG"
else
	TEXT=$(cat)
fi
if [[ -z "$TEXT" ]]; then
	echo '{"ok":false,"error":"empty input"}'
	exit 2
fi

case "${OSTYPE:-$(uname -s)}" in
	darwin*|Darwin*) SELECT_ALL_MOD="Meta" ;;
	*)               SELECT_ALL_MOD="Control" ;;
esac

# Runs one page script through the CLI and prints the JSON it returned.
run_js() {
	local raw line
	raw=$("${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} eval "$1" 2>&1) || {
		echo '{"ok":false,"error":"@playwright/cli eval failed"}'
		echo "$raw" >&2
		return 1
	}
	line=$(echo "$raw" | grep -A 1 '### Result' | tail -n1)
	# The CLI reports some failures, such as a session that is not attached, as
	# plain text with exit status 0, so an empty result is a failure too.
	if [[ -z "$line" ]]; then
		echo "{\"ok\":false,\"error\":$(echo "$raw" | head -n1 | jq -Rs .)}"
		echo "$raw" >&2
		return 1
	fi
	echo "$line" | jq -c 'fromjson' 2>/dev/null || {
		echo '{"ok":false,"error":"no result from the page"}'
		echo "$raw" >&2
		return 1
	}
}

# The page scripts live in console-run-page.ts, which JSON-escapes the code and names.
page_js() {
	node "$(dirname "${BASH_SOURCE[0]}")/console-run-page.ts" "$1" "$LANGUAGE" "$NAME" "$TEXT"
}

ensure_console_view
SELECTED=$(run_js "$(page_js select)") || { echo "$SELECTED"; exit 1; }
if [[ "$(echo "$SELECTED" | jq -r '.ok')" != "true" ]]; then
	echo "$SELECTED"
	exit 1
fi
TARGET=$(echo "$SELECTED" | jq -r '.sessionId')
BEFORE=$(echo "$SELECTED" | jq -r '.before')

# Clear anything half-typed in the input, through Monaco's own keys.
"${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} press "${SELECT_ALL_MOD}+a" >/dev/null 2>&1 || true
"${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} press Backspace >/dev/null 2>&1 || true

PASTED=$(run_js "$(page_js paste)") || { echo "$PASTED"; exit 1; }
if [[ "$(echo "$PASTED" | jq -r '.ok')" != "true" ]]; then
	echo "$SELECTED" | jq -c --argjson p "$PASTED" '. + {ok: false, error: $p.error} | del(.before)'
	exit 1
fi

if [[ "$ENTER" == "0" ]]; then
	log_action "console-run.sh" "$LANGUAGE (pasted, not run): $(printf '%s' "$TEXT" | head -n1 | cut -c1-200)"
	echo "$SELECTED" | jq -c '. + {echoed: null} | del(.before)'
	exit 0
fi

"${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} press Enter >/dev/null 2>&1

# The code is echoed above the prompt once the console accepts it. A busy
# session queues it, so that can take until the running code finishes.
ECHOED=false
DEADLINE=$(( $(date +%s) + TIMEOUT ))
while (( $(date +%s) <= DEADLINE )); do
	NOW=$(run_js "$(page_js count)") || { echo "$NOW"; exit 1; }
	if [[ "$(echo "$NOW" | jq -r '.id')" != "$TARGET" ]]; then
		echo "$SELECTED" | jq -c '. + {ok: false, echoed: false, error: "another console became active before the code ran"} | del(.before)'
		exit 1
	fi
	if (( $(echo "$NOW" | jq -r '.n') > BEFORE )); then
		ECHOED=true
		break
	fi
	sleep 0.3
done

if [[ "$ECHOED" == "true" ]]; then
	log_action "console-run.sh" "$LANGUAGE: $(printf '%s' "$TEXT" | head -n1 | cut -c1-200)"
	# An incomplete block (a Python loop with no blank line after it, an open
	# bracket) leaves the console at its continuation prompt, waiting, and
	# nothing has run.
	sleep 0.4
	PROMPT=$("$(dirname "${BASH_SOURCE[0]}")/console-read.sh" ${SESSION:+--session "$SESSION"} --language "$LANGUAGE" ${NAME:+--name "$NAME"} --prompt 2>/dev/null)
	if [[ "$PROMPT" == "..." || "$PROMPT" == "+" ]]; then
		echo "$SELECTED" | jq -c --arg p "$PROMPT" '. + {ok: false, echoed: true, prompt: $p, error: ("the console is waiting for more input (prompt " + $p + "): the code is incomplete and did not run. End a Python block with a blank line, or close the open bracket; press Escape in the console to clear it")} | del(.before)'
		exit 1
	fi
	if [[ "$CAPTURE" == "1" ]]; then
		# Done when the session has gone busy and come back, or never went busy
		# within 1.5 s (a quick command); then read what followed the code.
		END=$(( $(date +%s) + CAPTURE_TIMEOUT ))
		START=$(date +%s)
		SEEN_BUSY=0
		while (( $(date +%s) <= END )); do
			BUSY=$(run_js "(() => JSON.stringify({ busy: !!document.querySelector('.codicon-positron-interrupt-runtime') }))()") || break
			if [[ "$(echo "$BUSY" | jq -r '.busy')" == "true" ]]; then
				SEEN_BUSY=1
			elif (( SEEN_BUSY == 1 || $(date +%s) - START >= 2 )); then
				break
			fi
			sleep 0.3
		done
		sleep 0.3
		LAST=$(printf '%s' "$TEXT" | awk 'NF { line = $0 } END { gsub(/^[ \t]+|[ \t]+$/, "", line); print line }')
		OUTPUT=$("$(dirname "${BASH_SOURCE[0]}")/console-read.sh" ${SESSION:+--session "$SESSION"} --language "$LANGUAGE" ${NAME:+--name "$NAME"} --after "$LAST" --tail 0 2>/dev/null)
		echo "$SELECTED" | jq -c --arg out "$OUTPUT" '. + {echoed: true, output: $out} | del(.before)'
		exit 0
	fi
	echo "$SELECTED" | jq -c '. + {echoed: true} | del(.before)'
	exit 0
fi
echo "$SELECTED" | jq -c --arg t "$TIMEOUT" '. + {ok: false, echoed: false, error: ("the code was not echoed in this console within " + $t + " s; it may be queued behind running code")} | del(.before)'
exit 1
