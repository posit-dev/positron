#!/usr/bin/env bash
# Lists the TCP ports open for listening on this machine, with the process that
# owns each, so a run can tell whether a server it started is still running.
# Save the list before launching, then compare while your instance still runs:
# a port in the second list and not the first is a server the run started.
#
# Usage:
#   scripts/listeners.sh --save "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh --session NAME --diff "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh --tree 12345 --diff "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh --all --diff "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh
#
# Other runs on the machine start and stop servers too, so --diff keeps only
# listeners in your instance's process tree: its kernels and the apps they
# started. The instance is the one the Playwright session is attached to
# (--session NAME, or $PW_SESSION), or the PID given with --tree (launch.sh
# prints it as "pid"). --all compares every listener on the machine instead.
# With a tree, each line ends with the chain from the listener up to the
# instance, through the kernel supervisor (kcserver) and the kernels, which
# are this instance's own: every instance starts its own supervisor.
#
# A stopped instance has no tree: run --diff before stop.sh. After it, only
# --all is left, and a new port's PID is the clue to whose it is.
#
# Stdout: one line per listener, "<port> <pid> <command>", sorted by port.
#   With a tree, also "(<command> <pid> < ... < instance <pid>)".
#   With --diff, only the listeners not in the saved list.
# Exit code: 0, or 1 with --diff when there is a new listener, 2 when the
# instance is not running or not given.
#
# Required tools on PATH: lsof.

set -u
DIR="$(dirname "${BASH_SOURCE[0]}")"
TREE=""
SESSION="${PW_SESSION:-}"
ALL=0
MODE=""
FILE=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--tree) TREE="$2"; shift 2 ;;
		--session) SESSION="$2"; shift 2 ;;
		--session=*) SESSION="${1#--session=}"; shift ;;
		--all) ALL=1; shift ;;
		--save|--diff) MODE="$1"; FILE="${2:-}"; shift 2 ;;
		-h|--help) exec node "$DIR/dp.ts" help "$0" ;;
		*) echo "listeners.sh: unknown arg $1" >&2; exit 2 ;;
	esac
done
# --diff looks at your instance only: the one the session drives, unless --tree or --all.
if [[ "$MODE" == --diff && -z "$TREE" && "$ALL" == 0 ]]; then
	[[ -n "$SESSION" ]] || { echo "listeners.sh: --diff looks only at your instance: pass --session NAME or --tree PID, or --all for every listener on the machine" >&2; exit 2; }
	# The browser process of the instance the session is attached to is its main process.
	TREE=$("$(dirname "$0")/../../../../node_modules/.bin/playwright-cli" -s="$SESSION" --raw run-code \
		'async page => { const s = await page.context().browser().newBrowserCDPSession(); return String((await s.send("SystemInfo.getProcessInfo")).processInfo.find(p => p.type === "browser").id); }' 2>/dev/null | jq -r . 2>/dev/null)
	[[ "$TREE" =~ ^[0-9]+$ ]] || { echo "listeners.sh: session $SESSION is not attached to a running instance; run --diff before stop.sh, or pass --all" >&2; exit 2; }
fi
# A stopped instance has no tree, and an empty list would read as "all clean".
if [[ -n "$TREE" ]] && ! kill -0 "$TREE" 2>/dev/null; then
	echo "listeners.sh: process $TREE is not running, so its tree is gone; run --diff before stop.sh, or pass --all and check each new port's PID" >&2
	exit 2
fi
# The PID and every process under it.
descendants() {
	local all="$1" frontier="$1" next
	while [[ -n "$frontier" ]]; do
		next=""
		for p in $frontier; do next="$next $(pgrep -P "$p" 2>/dev/null | tr '\n' ' ')"; done
		frontier=$(echo $next)
		all="$all $frontier"
	done
	echo $all
}
# How a process descends from the instance: "ark 73987 < kcserver 73136 < ... < 72736".
chain() {
	local p="$1" out=""
	while [[ -n "$p" && "$p" != "$TREE" && "$p" != 1 ]]; do
		out="$out$(basename "$(ps -o comm= -p "$p" 2>/dev/null)") $p < "
		p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
	done
	echo "${out}instance $TREE"
}
list() {
	local rows
	rows=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { n = split($9, a, ":"); print a[n], $2, $1 }' | sort -u -n)
	if [[ -n "$TREE" ]]; then
		local keep=" $(descendants "$TREE") "
		printf '%s\n' "$rows" | while read -r port pid cmd; do [[ "$keep" == *" $pid "* ]] && echo "$port $pid $cmd  ($(chain "$pid"))"; done
	else
		printf '%s\n' "$rows" | sed '/^$/d'
	fi
}
case "$MODE" in
	--save) list > "$FILE"; wc -l < "$FILE" | tr -d ' ' | sed 's/$/ listeners saved/' >&2 ;;
	--diff)
		# By port, PID and command: a line from a tree also carries its chain.
		NEW=$(list | awk 'NR == FNR { seen[$1 " " $2 " " $3] = 1; next } !seen[$1 " " $2 " " $3]' "$FILE" -)
		if [[ -n "$NEW" ]]; then
			printf '%s\n' "$NEW" | sort -n
			exit 1
		fi
		;;
	"") list ;;
esac
