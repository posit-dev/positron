# Shared by the drive-positron scripts: the @playwright/cli command, the
# session flag, running one page script and reading its JSON, and the action
# log. Source it after setting SESSION (or leave it empty for $PW_SESSION).
#
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#   pw_setup "$SESSION_FLAG"
#   RESULT=$(run_js "$JS") || { echo "$RESULT"; exit 1; }
#   log_action "palette-run.sh" "Notebook: Run All Cells"
#
# Every script that acts on the app logs one line per action to the file named
# by $DRIVE_POSITRON_LOG, when it is set, as "<ISO time> <script>: <what>", so a
# test run's action log needs no wrapper scripts of its own.

PW_CLI=("$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/node_modules/.bin/playwright-cli")
if [[ ! -x "${PW_CLI[0]}" ]]; then
	PW_CLI=(npx @playwright/cli)
fi
PW_ARGS=()

# Sets PW_ARGS from a --session value, falling back to $PW_SESSION.
pw_setup() {
	local session="${1:-${PW_SESSION:-}}"
	PW_ARGS=()
	[[ -n "$session" ]] && PW_ARGS=("-s=$session")
	PW_SESSION_NAME="$session"
}

# Runs @playwright/cli with the session flag.
pw() {
	"${PW_CLI[@]}" ${PW_ARGS[@]+"${PW_ARGS[@]}"} "$@"
}

# Runs one page script and prints the JSON object it returned.
run_js() {
	local raw line
	raw=$(pw eval "$1" 2>&1) || {
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

# Appends one line to $DRIVE_POSITRON_LOG, when it is set.
log_action() {
	[[ -n "${DRIVE_POSITRON_LOG:-}" ]] || return 0
	printf '%s %s%s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${PW_SESSION_NAME:+ -s=$PW_SESSION_NAME}" "$2" >> "$DRIVE_POSITRON_LOG"
}

# A console that is not on screen, behind the Terminal or another panel tab, is
# not in the page at all, so bring the Console view forward first.
ensure_console_view() {
	local vis
	vis=$(run_js "(() => JSON.stringify({ ok: !!document.querySelector('.console-instance') }))()") || return 0
	if [[ "$(echo "$vis" | jq -r '.ok')" != "true" ]]; then
		"$(dirname "${BASH_SOURCE[0]}")/palette-run.sh" ${PW_SESSION_NAME:+--session "$PW_SESSION_NAME"} 'Console: Focus on Console View' >/dev/null 2>&1
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			vis=$(run_js "(() => JSON.stringify({ ok: !!document.querySelector('.console-instance') }))()") || break
			[[ "$(echo "$vis" | jq -r '.ok')" == "true" ]] && break
			sleep 0.3
		done
	fi
}

# The modifier the app binds Cmd-style shortcuts to on this platform.
case "${OSTYPE:-$(uname -s)}" in
	darwin*|Darwin*) CMD_MOD="Meta" ;;
	*)               CMD_MOD="Control" ;;
esac
