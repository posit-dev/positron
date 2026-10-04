#!/usr/bin/env bash
# Runs a command in a terminal, and checks the keys went to it. Typing into
# "the terminal" goes wherever focus is, and a console often has it, so a
# command meant for a shell runs as R or Python instead. This script focuses
# the terminal, pastes into its own input, presses Enter, and checks
# focus stayed. A terminal's sticky-scroll overlay does not count as a terminal.
#
# It does not open a terminal: open one first (Terminal: Create New Terminal,
# or Terminal: Create New Terminal in Editor Area). It cannot read the
# terminal's output, which is drawn on a canvas: take a screenshot for that.
#
# Usage:
#   scripts/terminal-run.sh --session NAME 'node mcp.mjs list'
#   scripts/terminal-run.sh --session NAME --index 2 'ls'   # with two terminals visible
#
# Flags:
#   --session NAME   the @playwright/cli session attached to the instance (or $PW_SESSION)
#   --index N        which visible terminal, numbered left to right then top to
#                    bottom; needed only when more than one is visible
#   --no-enter       paste the command but do not run it
#   --key KEY        send a key instead of a command, such as Control+c to stop
#                    a server, or Control+d; KEY is a Playwright key name
#
# Stdout: one JSON line, e.g.
#   {"ok":true,"index":1,"visible":1,"entered":true}
# Exit code: 0 when the command went to the terminal, 1 when it did not, 2 on a usage error.
#
# Required tools on PATH: node, jq.

set -u
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PW_CLI=("$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/node_modules/.bin/playwright-cli")
if [[ ! -x "${PW_CLI[0]}" ]]; then
	PW_CLI=(npx @playwright/cli)
fi

INDEX=""
ENTER=1
KEY=""
TEXT_ARG=""
PW_SESSION_OVERRIDE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--session) PW_SESSION_OVERRIDE="$2"; shift 2 ;;
		--session=*) PW_SESSION_OVERRIDE="${1#--session=}"; shift ;;
		--index) INDEX="$2"; shift 2 ;;
		--no-enter) ENTER=0; shift ;;
		--key) KEY="$2"; shift 2 ;;
		-h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		--) shift; TEXT_ARG="${*-}"; break ;;
		-*) echo "terminal-run.sh: unknown flag $1" >&2; exit 2 ;;
		*) TEXT_ARG="$1"; shift ;;
	esac
done

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

if [[ -n "$KEY" ]]; then
	FOCUSED=$(run_js "$(node "$(dirname "${BASH_SOURCE[0]}")/terminal-run-page.ts" focus "$INDEX" "")") || { echo "$FOCUSED"; exit 1; }
	if [[ "$(echo "$FOCUSED" | jq -r '.ok')" != "true" ]]; then echo "$FOCUSED"; exit 1; fi
	"${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} press "$KEY" >/dev/null 2>&1
	CHECKED=$(run_js "$(node "$(dirname "${BASH_SOURCE[0]}")/terminal-run-page.ts" check "$INDEX" "")") || { echo "$CHECKED"; exit 1; }
	if [[ "$(echo "$CHECKED" | jq -r '.ok')" != "true" ]]; then echo "$CHECKED" | jq -c '. + {sent: null}'; exit 1; fi
	log_action "terminal-run.sh" "key $KEY in terminal $(echo "$FOCUSED" | jq -r '.index')"
	echo "$FOCUSED" | jq -c --arg k "$KEY" '. + {sent: $k}'
	exit 0
fi

if [[ -n "${TEXT_ARG:-}" ]]; then
	TEXT="$TEXT_ARG"
else
	TEXT=$(cat)
fi
if [[ -z "$TEXT" ]]; then
	echo '{"ok":false,"error":"empty input"}'
	exit 2
fi

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

# The page scripts live in terminal-run-page.ts, which JSON-escapes the command.
page_js() {
	node "$(dirname "${BASH_SOURCE[0]}")/terminal-run-page.ts" "$1" "$INDEX" "$TEXT"
}

PASTED=$(run_js "$(page_js paste)") || { echo "$PASTED"; exit 1; }
if [[ "$(echo "$PASTED" | jq -r '.ok')" != "true" ]]; then
	echo "$PASTED"
	exit 1
fi

if [[ "$ENTER" == "0" ]]; then
	echo "$PASTED" | jq -c '. + {entered: false}'
	exit 0
fi

"${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} press Enter >/dev/null 2>&1

CHECKED=$(run_js "$(page_js check)") || { echo "$CHECKED"; exit 1; }
if [[ "$(echo "$CHECKED" | jq -r '.ok')" != "true" ]]; then
	echo "$PASTED" | jq -c --argjson c "$CHECKED" '. + {ok: false, entered: null, error: $c.error}'
	exit 1
fi
log_action "terminal-run.sh" "terminal $(echo "$PASTED" | jq -r '.index'): $(printf '%s' "$TEXT" | head -n1 | cut -c1-200)"
echo "$PASTED" | jq -c '. + {entered: true}'
exit 0
