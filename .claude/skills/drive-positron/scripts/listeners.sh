#!/usr/bin/env bash
# Lists the TCP ports open for listening on this machine, with the process that
# owns each, so a run can tell whether a server it started is still running.
# Save the list before launching, then compare after stopping: a port in the
# second list and not the first is a server the run left behind.
#
# Usage:
#   scripts/listeners.sh --save "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh --diff "$RUN/tmp/listeners-before.txt"
#   scripts/listeners.sh
#
# Other runs on the machine start and stop servers too. Pass --tree with your
# instance's PID (launch.sh prints it as "pid") to keep only listeners in its
# process tree: its kernels and the apps they started.
#
#   scripts/listeners.sh --tree 12345 --diff "$RUN/tmp/listeners-before.txt"
#
# Stdout: one line per listener, "<port> <pid> <command>", sorted by port.
#   With --diff, only the listeners not in the saved list.
# Exit code: 0, or 1 with --diff when there is a new listener.
#
# Required tools on PATH: lsof.

set -u
TREE=""
if [[ "${1:-}" == "--tree" ]]; then TREE="$2"; shift 2; fi
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
list() {
	local rows
	rows=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { n = split($9, a, ":"); print a[n], $2, $1 }' | sort -u -n)
	if [[ -n "$TREE" ]]; then
		local keep=" $(descendants "$TREE") "
		printf '%s\n' "$rows" | while read -r port pid cmd; do [[ "$keep" == *" $pid "* ]] && echo "$port $pid $cmd"; done
	else
		printf '%s\n' "$rows" | sed '/^$/d'
	fi
}
case "${1:-}" in
	--save) list > "$2"; wc -l < "$2" | tr -d ' ' | sed 's/$/ listeners saved/' >&2 ;;
	--diff)
		NEW=$(comm -13 <(sort "$2") <(list | sort))
		if [[ -n "$NEW" ]]; then
			printf '%s\n' "$NEW" | sort -n
			exit 1
		fi
		;;
	"") list ;;
	-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ;;
	*) echo "listeners.sh: unknown arg $1" >&2; exit 2 ;;
esac
